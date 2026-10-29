package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func fixture() (*service, *time.Time) {
	now := time.Date(2026, 10, 28, 10, 0, 0, 0, time.UTC)
	s := newService()
	s.now = func() time.Time { return now }
	s.reset("valid")
	return s, &now
}
func call(s *service, path string, c command) *httptest.ResponseRecorder {
	b, _ := json.Marshal(c)
	r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:9010/api/"+path, bytes.NewReader(b))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.api(w, r)
	return w
}
func expect(t *testing.T, w *httptest.ResponseRecorder, code int) {
	t.Helper()
	if w.Code != code {
		t.Fatalf("got %d, want %d: %s", w.Code, code, w.Body.String())
	}
}
func scan(t *testing.T, s *service, now *time.Time) {
	t.Helper()
	*now = now.Add(5 * time.Second)
	expect(t, call(s, "scan", command{Revision: s.state.Revision}), 200)
}
func token(t *testing.T, s *service) string {
	t.Helper()
	finishInspection(t, s)
	w := call(s, "open-request", command{Revision: s.state.Revision})
	expect(t, w, 200)
	var response struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.Token
}
func TestOpeningRequiresScanConfirmationAndIsSingleUse(t *testing.T) {
	s, now := fixture()
	rev := s.state.Revision
	expect(t, call(s, "open-request", command{Revision: rev}), 403)
	expect(t, call(s, "scan", command{Revision: rev}), 409)
	scan(t, s, now)
	key := token(t, s)
	expect(t, call(s, "open-confirm", command{Revision: rev, Token: key}), 409)
	if s.state.OpenedAt != 0 {
		t.Fatal("opened without explicit confirmation")
	}
	expect(t, call(s, "open-confirm", command{Revision: rev, Token: key, Confirmed: true}), 200)
	expect(t, call(s, "open-confirm", command{Revision: rev, Token: key, Confirmed: true}), 409)
	count := 0
	for _, item := range s.state.Audit {
		if item.Action == "barrier.opened" {
			count++
		}
	}
	if count != 1 || !s.state.Event.Opened {
		t.Fatalf("expected exactly one audited opening, got %d", count)
	}
	*now = now.Add(13 * time.Second)
	if s.snapshot().Barrier != "closed" {
		t.Fatal("barrier did not close after vehicle passed")
	}
}
func TestDeniedScenariosAndUnknownScenario(t *testing.T) {
	for _, scenario := range []string{"expired", "blocked"} {
		t.Run(scenario, func(t *testing.T) {
			s, now := fixture()
			s.reset(scenario)
			scan(t, s, now)
			expect(t, call(s, "open-request", command{Revision: s.state.Revision}), 403)
			if s.snapshot().Decision != scenario || s.state.OpenedAt != 0 {
				t.Fatal("incorrect access result")
			}
		})
	}
	s, _ := fixture()
	expect(t, call(s, "scenario", command{Scenario: "admin"}), 400)
}
func TestConfirmationRechecksExpiryBlockAndRevision(t *testing.T) {
	for _, change := range []string{"expiry", "blocked", "revision", "timeout", "cancelled"} {
		t.Run(change, func(t *testing.T) {
			s, now := fixture()
			scan(t, s, now)
			rev := s.state.Revision
			key := token(t, s)
			code := 403
			switch change {
			case "expiry":
				s.state.DemoAuthorization.ValidTill = now.UnixMilli()
			case "blocked":
				s.state.Entry.IsBlocked = true
			case "revision":
				s.reset("valid")
				code = 409
			case "timeout":
				*now = now.Add(31 * time.Second)
				code = 409
			case "cancelled":
				expect(t, call(s, "open-cancel", command{Revision: rev}), 200)
				code = 409
			}
			expect(t, call(s, "open-confirm", command{Revision: rev, Token: key, Confirmed: true}), code)
			if s.state.OpenedAt != 0 {
				t.Fatal("stale or denied confirmation opened barrier")
			}
		})
	}
}
func TestConcurrentConfirmationsOpenOnce(t *testing.T) {
	s, now := fixture()
	scan(t, s, now)
	c := command{Revision: s.state.Revision, Token: token(t, s), Confirmed: true}
	var wg sync.WaitGroup
	codes := make(chan int, 8)
	for range 8 {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- call(s, "open-confirm", c).Code }()
	}
	wg.Wait()
	close(codes)
	successes := 0
	for code := range codes {
		if code == 200 {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("got %d successful openings", successes)
	}
}
func TestRejectForeignOriginAndHost(t *testing.T) {
	handler := localOnly(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, tc := range []struct {
		host, origin string
		code         int
	}{
		{"127.0.0.1:9010", "http://127.0.0.1:9010", 204},
		{"localhost:9010", "", 204},
		{"127.0.0.1:9010", "https://example.com", 403},
		{"evil.example:9010", "", 403},
		{"127.0.0.1:9010", "null", 403},
	} {
		r := httptest.NewRequest("GET", "http://"+tc.host+"/api/state", nil)
		r.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		expect(t, w, tc.code)
	}
}
func TestDecisionTimeBoundaries(t *testing.T) {
	s, now := fixture()
	scan(t, s, now)
	s.state.DemoAuthorization.ValidFrom = now.Add(time.Minute).UnixMilli()
	if status, _ := s.decision(); status != "not_yet_valid" {
		t.Fatal(status)
	}
	s.state.DemoAuthorization.ValidFrom = now.UnixMilli()
	if status, _ := s.decision(); status != "valid" {
		t.Fatal(status)
	}
	s.state.DemoAuthorization.ValidTill = now.UnixMilli()
	if status, _ := s.decision(); status != "expired" {
		t.Fatal(status)
	}
}
