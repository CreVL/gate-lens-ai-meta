package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"image/png"
	"net/http"
	"strings"
)

// This plan is an independently authored demo assignment, not an authorization
// inferred from historical records. All captures are from the 3D simulator.
type Inspection struct {
	Flow             string              `json:"flow"`
	Assessment       *Assessment         `json:"assessment"`
	ID               string              `json:"id"`
	Version          int                 `json:"version"`
	Step             string              `json:"step"`
	ExpectedSeal     string              `json:"expectedSeal"`
	ObservedSeal     string              `json:"observedSeal"`
	SealMatches      bool                `json:"sealMatches"`
	TrailerConfirmed bool                `json:"trailerConfirmed"`
	CaptureID        string              `json:"captureId"`
	Photo            *Evidence           `json:"photo"`
	Incident         *InspectionIncident `json:"incident"`
	CompletedAt      int64               `json:"completedAt"`
}
type Evidence struct {
	ID         string `json:"id"`
	URL        string `json:"url"`
	Source     string `json:"source"`
	CapturedAt int64  `json:"capturedAt"`
	Accepted   bool   `json:"accepted"`
}
type InspectionIncident struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	Title     string `json:"title"`
	Type      string `json:"type"`
	Reason    string `json:"reason"`
	Expected  string `json:"expected"`
	Observed  string `json:"observed"`
	PhotoID   string `json:"photoId"`
	CreatedAt int64  `json:"createdAt"`
}

func inspectionID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func (s *service) resetInspection() {
	if s.visionCancel != nil {
		s.visionCancel()
	}
	s.state.Inspection = Inspection{ID: "INS-" + inspectionID(), Version: 1, Step: "ready", ExpectedSeal: s.state.Job.ExpectedSeal, Flow: s.state.Job.Flow}
	s.photo = nil
}
func (s *service) evidence(w http.ResponseWriter, r *http.Request) {
	p := s.state.Inspection.Photo
	if p == nil || r.URL.Query().Get("id") != p.ID || len(s.photo) == 0 {
		problem(w, 404, "Evidence no longer available in this demo session")
		return
	}
	if r.URL.Path == "/api/photo" {
		jsonReply(w, 200, map[string]string{"imageBase64": base64.StdEncoding.EncodeToString(s.photo)})
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(s.photo)
}

func (s *service) inspect(w http.ResponseWriter, r *http.Request, c command) {
	i := &s.state.Inspection
	if c.InspectionVersion != i.Version {
		problem(w, 409, "Inspection changed. Refresh before continuing.")
		return
	}
	if decision, reason := s.decision(); decision != "valid" {
		problem(w, 403, reason)
		return
	}
	step := i.Step
	reject := func() { problem(w, 409, "Complete the current inspection step first: "+step) }
	switch strings.TrimPrefix(r.URL.Path, "/api/inspection/") {
	case "start":
		if step != "ready" {
			reject()
			return
		}
		i.Step = "trailer"
	case "trailer":
		if step != "trailer" || !c.Confirmed {
			reject()
			return
		}
		i.TrailerConfirmed = true
		i.Step = "seal"
	case "seal":
		problem(w, 409, "Capture a photo to read the seal. Simulated seal input has been removed.")
		return
	case "capture":
		if step != "seal" && step != "photo" && step != "photo_pending" && step != "photo_review" && step != "analyzing" {
			reject()
			return
		}
		if s.visionCancel != nil {
			s.visionCancel()
		}
		i.Assessment = nil
		i.ObservedSeal = ""
		i.SealMatches = false
		i.CaptureID = inspectionID()
		i.Photo = nil
		s.photo = nil
		i.Step = "photo_pending"
	case "upload":
		if step != "photo_pending" || c.CaptureID == "" || c.CaptureID != i.CaptureID {
			reject()
			return
		}
		if !strings.HasPrefix(c.Image, "data:image/png;base64,") {
			problem(w, 400, "PNG scene evidence required")
			return
		}
		data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(c.Image, "data:image/png;base64,"))
		if err != nil || len(data) > 1500000 {
			problem(w, 400, "Invalid or oversized image")
			return
		}
		config, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil || config.Width < 160 || config.Height < 90 || config.Width > 1280 || config.Height > 960 {
			problem(w, 400, "Evidence dimensions must be 160x90 to 1280x960")
			return
		}
		if _, err = png.Decode(bytes.NewReader(data)); err != nil {
			problem(w, 400, "Incomplete PNG")
			return
		}
		s.photo = data
		i.Photo = &Evidence{ID: i.CaptureID, URL: "/api/evidence?id=" + i.CaptureID, Source: "3d-scene", CapturedAt: s.now().UnixMilli()}
		i.CaptureID = ""
		i.Step = "analyzing"
		s.startRecognition()
	case "accept-photo":
		if step != "photo_review" || i.Photo == nil || len(s.photo) == 0 || i.Assessment == nil || i.Assessment.Status != "readable" {
			reject()
			return
		}
		i.Photo.Accepted = true
		i.Step = "review"
	case "report":
		if step != "photo_review" || i.Photo == nil || i.Assessment == nil || i.Assessment.Status == "readable" {
			reject()
			return
		}
		i.Photo.Accepted = true
		i.Step = "issue_review"
	case "submit":
		if (step != "review" && step != "issue_review") || !i.TrailerConfirmed || i.Photo == nil || !i.Photo.Accepted || len(s.photo) == 0 || i.Assessment == nil || (step == "review" && (i.Assessment.Status != "readable" || i.ObservedSeal == "")) {
			reject()
			return
		}
		i.CompletedAt = s.now().UnixMilli()
		if step == "review" && (i.SealMatches || i.Flow == "register") {
			i.Step = "complete"
		} else {
			i.Step = "incident"
			i.Incident = &InspectionIncident{ID: "INC-" + inspectionID(), Status: "Open", Title: "Seal mismatch", Type: "Seal mismatch", Reason: "Seal does not match the demo dispatch plan", Expected: i.ExpectedSeal, Observed: i.ObservedSeal, PhotoID: i.Photo.ID, CreatedAt: i.CompletedAt}
			if step == "issue_review" {
				i.Incident.Title = "Seal inspection needs review"
				i.Incident.Type = "Inspection review"
				i.Incident.Reason = i.Assessment.Reason
			}
			s.audit("incident.created", fmt.Sprintf("%s; expected %s; observed %s; evidence %s; hold for supervisor", i.Incident.ID, i.ExpectedSeal, i.ObservedSeal, i.Photo.ID))
		}
	default:
		problem(w, 404, "Unknown inspection action")
		return
	}
	i.Version++
	s.audit("inspection."+strings.TrimPrefix(r.URL.Path, "/api/inspection/"), i.ID+" / "+i.Step)
	jsonReply(w, 200, s.snapshot())
}
