package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"time"
)

type Assessment struct {
	Status      string  `json:"status"`
	Number      string  `json:"number"`
	Present     bool    `json:"present"`
	Confidence  float64 `json:"confidence"`
	Reason      string  `json:"reason"`
	Engine      string  `json:"engine"`
	Detector    string  `json:"detector"`
	ImageSHA256 string  `json:"imageSha256"`
}
type recognizer func(context.Context, []byte) (Assessment, error)

var sealFormat = regexp.MustCompile(`^[A-Z]{2}-[0-9]{5}$`)

func commandRecognizer(script string) recognizer {
	return func(ctx context.Context, image []byte) (Assessment, error) {
		var result Assessment
		input, _ := json.Marshal(map[string]string{"image": base64.StdEncoding.EncodeToString(image)})
		cmd := exec.CommandContext(ctx, "node", script)
		cmd.Stdin = bytes.NewReader(input)
		var output, diagnostic bytes.Buffer
		cmd.Stdout = &output
		cmd.Stderr = &diagnostic
		if err := cmd.Run(); err != nil {
			return result, fmt.Errorf("local OCR failed: %w", err)
		}
		if err := json.Unmarshal(output.Bytes(), &result); err != nil {
			return result, err
		}
		digest := sha256.Sum256(image)
		if result.ImageSHA256 != hex.EncodeToString(digest[:]) {
			return result, fmt.Errorf("OCR image digest mismatch")
		}
		return result, nil
	}
}
func (s *service) startRecognition() {
	if s.visionCancel != nil {
		s.visionCancel()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	s.visionCancel = cancel
	revision, id, photoID := s.state.Revision, s.state.Inspection.ID, s.state.Inspection.Photo.ID
	image := append([]byte(nil), s.photo...)
	recognize := s.recognize
	go func() {
		defer cancel()
		result := Assessment{Status: "unavailable", Reason: "Local OCR unavailable. Check Node dependencies, then retake or report for manual review."}
		if recognize != nil {
			if read, err := recognize(ctx, image); err == nil {
				result = read
			}
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		i := &s.state.Inspection
		if s.state.Revision != revision || i.ID != id || i.Photo == nil || i.Photo.ID != photoID || i.Step != "analyzing" {
			return
		}
		if result.Status == "readable" && (!result.Present || result.Confidence < 70 || !sealFormat.MatchString(result.Number)) {
			result.Status = "unreadable"
			result.Reason = "OCR confidence or number format is insufficient. Retake the photo."
		}
		if result.Status != "readable" {
			result.Number = ""
		}
		i.Assessment = &result
		i.ObservedSeal = result.Number
		i.SealMatches = result.Status == "readable" && i.ExpectedSeal != "" && i.ExpectedSeal == result.Number
		i.Step = "photo_review"
		i.Version++
		s.audit("inspection.recognized", i.ID+" / "+result.Status+" / "+result.Number)
	}()
}
