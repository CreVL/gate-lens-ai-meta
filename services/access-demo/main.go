// Local synthetic access service. Never connect this demonstration to hardware.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Visitor struct {
	Name          string                  `json:"name"`
	Company       string                  `json:"company"`
	Category      string                  `json:"category"`
	CarLic        string                  `json:"carLic"`
	CarLicSet     []string                `json:"carLicSet"`
	IsOnSite      bool                    `json:"isOnSite"`
	VisitorFields map[string]VisitorField `json:"visitorFields"`
}
type VisitorField struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Separate local policy: historical GateLens entry fields are not authorization.
type DemoAuthorization struct {
	ValidFrom int64 `json:"validFrom"`
	ValidTill int64 `json:"validTill"`
}
type Vehicle struct {
	License     string `json:"license"`
	Manufacture string `json:"manufacture"`
	Model       string `json:"model"`
	Color       string `json:"color"`
}
type Entry struct {
	UID                 string               `json:"uid"`
	Type                string               `json:"type"`
	Name                string               `json:"name"`
	DeviceName          string               `json:"deviceName"`
	AppType             string               `json:"appType"`
	Licence             string               `json:"licence"`
	ProfileName         string               `json:"profileName"`
	Company             string               `json:"company"`
	IsBlocked           bool                 `json:"isBlocked"`
	BlockedMessage      string               `json:"blockedMessage"`
	Visitor             Visitor              `json:"visitor"`
	CarLicScans         map[string]Vehicle   `json:"carLicScans"`
	CustomFields        map[string]string    `json:"customFields"`
	CustomFieldsObjects map[string]ScanField `json:"customFieldsObjects"`
}
type ScanField struct {
	Type            string `json:"type"`
	CustomFieldName string `json:"customFieldName"`
	CustomFieldType string `json:"customFieldType"`
	DriverInitials  string `json:"driverLicScanInitials,omitempty"`
	DriverLastName  string `json:"driverLicScanLastName,omitempty"`
	CarLicense      string `json:"carLicScanLicense,omitempty"`
	Text            string `json:"text,omitempty"`
}
type Event struct {
	UID          string `json:"uid"`
	TextOriginal string `json:"textOriginal"`
	ClearText    string `json:"clearText"`
	DeviceName   string `json:"deviceName"`
	CreatedTime  int64  `json:"createdTime"`
	Opened       bool   `json:"opened"`
	OpenedTime   int64  `json:"openedTime"`
}
type Audit struct {
	At       int64  `json:"at"`
	Action   string `json:"action"`
	Reason   string `json:"reason"`
	Revision int    `json:"revision"`
	Actor    string `json:"actor"`
}
type State struct {
	Job               InspectionJob     `json:"job"`
	Inspection        Inspection        `json:"inspection"`
	Revision          int               `json:"revision"`
	Scenario          string            `json:"scenario"`
	StartedAt         int64             `json:"startedAt"`
	ServerTime        int64             `json:"serverTime"`
	Entry             Entry             `json:"entry"`
	DemoAuthorization DemoAuthorization `json:"demoAuthorization"`
	Presentation      EntryPresentation `json:"presentation"`
	Event             *Event            `json:"event"`
	Decision          string            `json:"decision"`
	Reason            string            `json:"reason"`
	Barrier           string            `json:"barrier"`
	OpenedAt          int64             `json:"openedAt"`
	Audit             []Audit           `json:"audit"`
}
type service struct {
	recognize    recognizer
	visionCancel context.CancelFunc
	photo        []byte
	mu           sync.Mutex
	state        State
	token        string
	tokenUntil   time.Time
	now          func() time.Time
}
type command struct {
	InspectionVersion int    `json:"inspectionVersion"`
	CaptureID         string `json:"captureId"`
	Image             string `json:"image"`
	Scenario          string `json:"scenario"`
	Revision          int    `json:"revision"`
	Token             string `json:"token"`
	Confirmed         bool   `json:"confirmed"`
}

func newService() *service {
	s := &service{now: time.Now}
	s.reset("valid")
	return s
}
func (s *service) audit(action, reason string) {
	s.state.Audit = append(s.state.Audit, Audit{s.now().UnixMilli(), action, reason, s.state.Revision, "demo-guard"})
	if len(s.state.Audit) > 100 {
		s.state.Audit = s.state.Audit[len(s.state.Audit)-100:]
	}
}
func (s *service) reset(scenario string) {
	now := s.now()
	till := now.Add(8 * time.Hour).UnixMilli()
	if scenario == "expired" {
		till = now.Add(-time.Hour).UnixMilli()
	}
	job, _ := inspectionJob(scenario)
	entry := jobEntry(job, scenario)
	if entry.IsBlocked {
		entry.BlockedMessage = "Permit suspended. Contact the supervisor."
	}
	s.state = State{Revision: s.state.Revision + 1, Scenario: scenario, StartedAt: now.UnixMilli(), Entry: entry, DemoAuthorization: DemoAuthorization{now.Add(-24 * time.Hour).UnixMilli(), till}, Barrier: "closed", Audit: s.state.Audit}
	s.token = ""
	s.state.Job = job
	s.resetInspection()
	s.audit("scenario.started", scenario)
}
func (s *service) decision() (string, string) {
	if s.state.Event == nil {
		return "unscanned", "Awaiting a simulated plate scan"
	}
	e := s.state.Entry
	if e.IsBlocked {
		return "blocked", e.BlockedMessage
	}
	now := s.now().UnixMilli()
	if now < s.state.DemoAuthorization.ValidFrom {
		return "not_yet_valid", "Permit is not active yet"
	}
	if now >= s.state.DemoAuthorization.ValidTill {
		return "expired", "Permit expired. Opening is unavailable."
	}
	return "valid", "Demo assignment available. Complete the truck inspection."
}
func (s *service) snapshot() State {
	s.state.ServerTime = s.now().UnixMilli()
	s.state.Decision, s.state.Reason = s.decision()
	s.state.Presentation = presentEntry(s.state.Entry)
	if s.state.OpenedAt > 0 {
		elapsed := s.now().UnixMilli() - s.state.OpenedAt
		switch {
		case elapsed < 1600:
			s.state.Barrier = "opening"
		case elapsed < 10500:
			s.state.Barrier = "open"
		case elapsed < 12100:
			s.state.Barrier = "closing"
		default:
			if s.state.Barrier != "closed" {
				s.audit("barrier.closed", "Virtual vehicle cleared the lane")
			}
			s.state.Barrier = "closed"
		}
	}
	return s.state
}
func jsonReply(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func problem(w http.ResponseWriter, status int, message string) {
	jsonReply(w, status, map[string]string{"error": message})
}
func readCommand(w http.ResponseWriter, r *http.Request) (command, error) {
	var c command
	if r.Header.Get("Content-Type") != "application/json" {
		return c, errors.New("Expected application/json")
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2200000))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&c); err != nil {
		return c, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return c, errors.New("Expected one JSON object")
	}
	return c, nil
}
func (s *service) api(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.URL.Path == "/api/state" && r.Method == "GET" {
		jsonReply(w, 200, s.snapshot())
		return
	}
	if r.Method == "GET" && (r.URL.Path == "/api/photo" || r.URL.Path == "/api/evidence") {
		s.evidence(w, r)
		return
	}
	if r.Method != "POST" {
		problem(w, 405, "Use POST")
		return
	}
	c, err := readCommand(w, r)
	if err != nil {
		problem(w, 400, "Invalid command: "+err.Error())
		return
	}
	if r.URL.Path == "/api/scenario" {
		if _, ok := inspectionJob(c.Scenario); !ok {
			problem(w, 400, "Unknown scenario")
			return
		}
		s.reset(c.Scenario)
		jsonReply(w, 200, s.snapshot())
		return
	}
	if c.Revision != s.state.Revision {
		problem(w, 409, "Scenario changed. Inspect the current vehicle again.")
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/inspection/") {
		s.inspect(w, r, c)
		return
	}
	switch r.URL.Path {
	case "/api/scan":
		if s.now().UnixMilli()-s.state.StartedAt < 4500 {
			problem(w, 409, "Vehicle has not reached the scan zone")
			return
		}
		if s.state.Event == nil {
			s.state.Event = &Event{UID: fmt.Sprintf("lpr-demo-%d", s.state.Revision), TextOriginal: s.state.Entry.Licence, ClearText: s.state.Entry.Licence, DeviceName: s.state.Entry.DeviceName, CreatedTime: s.now().UnixMilli()}
			s.audit("lpr.detected", s.state.Entry.Licence)
		}
	case "/api/open-request":
		if s.state.Inspection.Step != "complete" || !s.state.Inspection.SealMatches {
			problem(w, 403, "A complete matching inspection is required. Incident cases remain on hold.")
			return
		}
		decision, reason := s.decision()
		if decision != "valid" {
			s.audit("opening.denied", reason)
			problem(w, 403, reason)
			return
		}
		if s.state.OpenedAt != 0 {
			problem(w, 409, "This entry has already been used. Start a new scenario.")
			return
		}
		var b [24]byte
		if _, err := rand.Read(b[:]); err != nil {
			problem(w, 500, "Could not create confirmation")
			return
		}
		s.token = hex.EncodeToString(b[:])
		s.tokenUntil = s.now().Add(30 * time.Second)
		s.audit("opening.requested", "Awaiting explicit guard confirmation")
		jsonReply(w, 200, map[string]any{"token": s.token, "revision": s.state.Revision, "expiresAt": s.tokenUntil.UnixMilli()})
		return
	case "/api/open-confirm":
		if !c.Confirmed || c.Token == "" || c.Token != s.token || !s.now().Before(s.tokenUntil) {
			s.audit("opening.denied", "Missing, stale or unconfirmed request")
			problem(w, 409, "Confirmation expired or is invalid. Request opening again.")
			return
		}
		s.token = ""
		if s.state.Inspection.Step != "complete" || !s.state.Inspection.SealMatches {
			problem(w, 403, "Inspection is not cleared")
			return
		}
		decision, reason := s.decision()
		if decision != "valid" {
			s.audit("opening.denied", reason)
			problem(w, 403, reason)
			return
		}
		if s.state.OpenedAt != 0 {
			problem(w, 409, "Entry already used")
			return
		}
		s.state.OpenedAt = s.now().UnixMilli()
		s.state.Event.Opened = true
		s.state.Event.OpenedTime = s.state.OpenedAt
		s.audit("barrier.opened", "Explicit confirmation; deterministic authorization; virtual barrier only")
	case "/api/open-cancel":
		s.token = ""
		s.audit("opening.cancelled", "Guard cancelled confirmation")
	default:
		problem(w, 404, "Unknown endpoint")
		return
	}
	jsonReply(w, 200, s.snapshot())
}
func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil || (host != "127.0.0.1" && host != "localhost") {
			problem(w, 403, "Loopback host required")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Scheme != "http" || u.Host != r.Host {
				problem(w, 403, "Same-origin requests only")
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		if isMetaPath(r.URL.Path) {
			// DAT's own meta CSP remains in force; its renderer uses inline styles.
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		}
		next.ServeHTTP(w, r)
	})
}
func main() {
	web := flag.String("web", "../../apps/simulator/public", "Path to simulator public files")
	port := flag.Int("port", 9010, "Loopback HTTP port")
	flag.Parse()
	root, err := filepath.Abs(*web)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "vendor", "three.module.js")); err != nil {
		log.Fatal("Run scripts/start-walkthrough.ps1 to prepare Three.js assets")
	}
	mux := http.NewServeMux()
	service := newService()
	service.recognize = commandRecognizer(filepath.Join(root, "..", "..", "..", "apps", "simulator", "scripts", "seal-vision.mjs"))
	mux.HandleFunc("/api/", service.api)
	proxy := metaProxy()
	for _, path := range []string{"/glasses", "/preview.js", "/preview.css", "/host.js", "/display/"} {
		mux.Handle(path, proxy)
	}
	mux.HandleFunc("/glasses/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/glasses", http.StatusTemporaryRedirect)
	})
	mux.Handle("/", http.FileServer(http.Dir(root)))
	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	fmt.Printf("GateLens walkthrough: http://%s\nOpen it manually. Ctrl+C stops the server. All data and barriers are synthetic.\n", addr)
	server := &http.Server{Addr: addr, Handler: localOnly(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	log.Fatal(server.ListenAndServe())
}
