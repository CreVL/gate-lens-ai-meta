package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/png"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func evidencePNG(t *testing.T) string {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 320, 180))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}
func inspectCall(s *service, action string) *httptest.ResponseRecorder {
	return call(s, "inspection/"+action, command{Revision: s.state.Revision, InspectionVersion: s.state.Inspection.Version, Confirmed: true})
}
func throughPhoto(t *testing.T, s *service) {
	t.Helper()
	number := s.state.Job.SceneSeal
	if s.recognize == nil {
		s.recognize = func(context.Context, []byte) (Assessment, error) {
			return Assessment{Status: "readable", Number: number, Present: true, Confidence: 95}, nil
		}
	}

	for _, action := range []string{"start", "trailer", "capture"} {
		expect(t, inspectCall(s, action), 200)
	}
	expect(t, call(s, "inspection/upload", command{Revision: s.state.Revision, InspectionVersion: s.state.Inspection.Version, CaptureID: s.state.Inspection.CaptureID, Image: evidencePNG(t)}), 200)
	waitRecognition(t, s)
}
func finishInspection(t *testing.T, s *service) {
	t.Helper()
	throughPhoto(t, s)
	expect(t, inspectCall(s, "accept-photo"), 200)
	expect(t, inspectCall(s, "submit"), 200)
}
func TestInspectionMatchingAndMismatchEvidence(t *testing.T) {
	for _, scenario := range []string{"valid", "mismatch"} {
		t.Run(scenario, func(t *testing.T) {
			s, now := fixture()
			s.reset(scenario)
			scan(t, s, now)
			expect(t, call(s, "open-request", command{Revision: s.state.Revision}), 403)
			finishInspection(t, s)
			i := s.state.Inspection
			if i.Photo == nil || !i.Photo.Accepted || i.CompletedAt == 0 || s.state.OpenedAt != 0 {
				t.Fatal("missing evidence or unexpected gate action")
			}
			if scenario == "valid" {
				if i.Step != "complete" || i.Incident != nil {
					t.Fatal("matching seal not completed")
				}
			} else {
				if i.Step != "incident" || i.Incident == nil || i.Incident.PhotoID != i.Photo.ID || i.Incident.Expected == i.Incident.Observed || i.Incident.Status != "Open" {
					t.Fatal("incident evidence incorrect")
				}
				expect(t, call(s, "open-request", command{Revision: s.state.Revision}), 403)
			}
			expect(t, inspectCall(s, "submit"), 409)
			r := httptest.NewRequest("GET", "http://127.0.0.1:9010"+i.Photo.URL, nil)
			w := httptest.NewRecorder()
			s.api(w, r)
			expect(t, w, 200)
			if _, err := png.Decode(bytes.NewReader(w.Body.Bytes())); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestInspectionRejectsSkipStaleAndWrongCapture(t *testing.T) {
	s, now := fixture()
	expect(t, inspectCall(s, "start"), 403)
	scan(t, s, now)
	expect(t, inspectCall(s, "submit"), 409)
	expect(t, inspectCall(s, "capture"), 409)
	initial := s.state.Inspection.Version
	expect(t, inspectCall(s, "start"), 200)
	expect(t, call(s, "inspection/trailer", command{Revision: s.state.Revision, InspectionVersion: initial, Confirmed: true}), 409)
	expect(t, inspectCall(s, "trailer"), 200)
	expect(t, inspectCall(s, "seal"), 409)
	expect(t, inspectCall(s, "capture"), 200)
	old := command{Revision: s.state.Revision, InspectionVersion: s.state.Inspection.Version, CaptureID: s.state.Inspection.CaptureID, Image: evidencePNG(t)}
	expect(t, inspectCall(s, "capture"), 200)
	expect(t, call(s, "inspection/upload", old), 409)
	bad := command{Revision: s.state.Revision, InspectionVersion: s.state.Inspection.Version, CaptureID: s.state.Inspection.CaptureID, Image: "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("not a png"))}
	expect(t, call(s, "inspection/upload", bad), 400)
	if s.state.Inspection.Photo != nil {
		t.Fatal("invalid evidence saved")
	}
	s.reset("mismatch")
	expect(t, call(s, "inspection/upload", old), 409)
}
func TestRetakeAndResetInvalidateEvidence(t *testing.T) {
	s, now := fixture()
	scan(t, s, now)
	throughPhoto(t, s)
	oldURL := s.state.Inspection.Photo.URL
	expect(t, inspectCall(s, "capture"), 200)
	if s.state.Inspection.Photo != nil || len(s.photo) != 0 {
		t.Fatal("retake kept old evidence")
	}
	expect(t, inspectCall(s, "accept-photo"), 409)
	r := httptest.NewRequest("GET", "http://127.0.0.1:9010"+oldURL, nil)
	w := httptest.NewRecorder()
	s.api(w, r)
	expect(t, w, 404)
	s.reset("valid")
	scan(t, s, now)
	finishInspection(t, s)
	oldURL = s.state.Inspection.Photo.URL
	s.reset("valid")
	w = httptest.NewRecorder()
	s.api(w, httptest.NewRequest("GET", "http://127.0.0.1:9010"+oldURL, nil))
	expect(t, w, 404)
	if strings.Contains(s.state.Inspection.ID, "undefined") {
		t.Fatal("invalid ID")
	}
}

func waitRecognition(t *testing.T, s *service) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		ready := s.state.Inspection.Step == "photo_review"
		s.mu.Unlock()
		if ready {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("recognition did not finish")
}
func TestRecognitionCannotGuessOrBypassUnreadablePhoto(t *testing.T) {
	for _, status := range []string{"no_seal", "unreadable", "unavailable", "readable"} {
		t.Run(status, func(t *testing.T) {
			s, now := fixture()
			scan(t, s, now)
			s.recognize = func(context.Context, []byte) (Assessment, error) {
				return Assessment{Status: status, Number: s.state.Job.ExpectedSeal, Confidence: 20, Present: true}, nil
			}
			throughPhoto(t, s)
			if s.state.Inspection.ObservedSeal != "" || s.state.Inspection.SealMatches {
				t.Fatal("uncertain OCR supplied a number")
			}
			expect(t, inspectCall(s, "accept-photo"), 409)
			expect(t, inspectCall(s, "submit"), 409)
			expect(t, inspectCall(s, "report"), 200)
			expect(t, inspectCall(s, "submit"), 200)
			if s.state.Inspection.Incident.Type != "Inspection review" || s.state.OpenedAt != 0 {
				t.Fatal("manual review must hold the truck")
			}
		})
	}
}
func TestArrivalRecordsWithoutPretendingReferenceMatch(t *testing.T) {
	s, now := fixture()
	s.reset("arrival")
	scan(t, s, now)
	finishInspection(t, s)
	if s.state.Inspection.Step != "complete" || s.state.Inspection.SealMatches || s.state.Inspection.ExpectedSeal != "" || s.state.Inspection.ObservedSeal == "" {
		t.Fatal("registration confused with matching")
	}
	expect(t, call(s, "open-request", command{Revision: s.state.Revision}), 403)
}
func TestResetCancelsOCRAndRejectsLateResult(t *testing.T) {
	s, now := fixture()
	scan(t, s, now)
	started := make(chan struct{})
	returned := make(chan struct{})
	s.recognize = func(ctx context.Context, _ []byte) (Assessment, error) {
		close(started)
		<-ctx.Done()
		defer close(returned)
		return Assessment{Status: "readable", Number: "CG-24081", Present: true, Confidence: 99}, nil
	}
	for _, action := range []string{"start", "trailer", "capture"} {
		expect(t, inspectCall(s, action), 200)
	}
	expect(t, call(s, "inspection/upload", command{Revision: s.state.Revision, InspectionVersion: s.state.Inspection.Version, CaptureID: s.state.Inspection.CaptureID, Image: evidencePNG(t)}), 200)
	<-started
	expect(t, call(s, "scenario", command{Scenario: "arrival"}), 200)
	<-returned
	time.Sleep(10 * time.Millisecond)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Inspection.Step != "ready" || s.state.Inspection.ObservedSeal != "" || s.state.Inspection.Photo != nil {
		t.Fatal("late OCR leaked into next truck")
	}
}
