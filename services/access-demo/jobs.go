package main

import (
	_ "embed"
	"encoding/json"
)

//go:embed fixtures/inspection_jobs.json
var jobsJSON []byte

type InspectionJob struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	Flow         string `json:"flow"`
	Plate        string `json:"plate"`
	Trailer      string `json:"trailer"`
	Company      string `json:"company"`
	Driver       string `json:"driver"`
	Destination  string `json:"destination"`
	ExpectedSeal string `json:"expectedSeal"`
	SceneSeal    string `json:"sceneSeal"`
	Condition    string `json:"condition"`
}

func inspectionJob(id string) (InspectionJob, bool) {
	var jobs []InspectionJob
	if err := json.Unmarshal(jobsJSON, &jobs); err != nil {
		panic(err)
	}
	for _, j := range jobs {
		if j.ID == id {
			return j, true
		}
	}
	// Retain the legacy expired authorization case for boundary tests.
	if id == "expired" {
		return jobs[0], true
	}
	return InspectionJob{}, false
}
func jobEntry(j InspectionJob, scenario string) Entry {
	e := demoEntry(scenario)
	e.Licence = j.Plate
	e.Company = j.Company
	e.Name = j.Driver
	e.IsBlocked = scenario == "blocked"
	e.Visitor.CarLic = j.Plate
	e.Visitor.CarLicSet = []string{j.Plate}
	e.Visitor.Company = j.Company
	e.Visitor.Name = "Fleet truck " + j.Plate
	e.ProfileName = "Dispatch / seal comparison"
	e.Type = "out"
	if j.Flow == "register" {
		e.ProfileName = "Receiving / seal registration"
		e.Type = "in"
	}
	e.CustomFields["Destination For CLDA 1"] = j.Destination
	e.CustomFieldsObjects["fixture-driver"] = ScanField{Type: "barcodeDriverLicScan", DriverLastName: j.Driver}
	e.CustomFieldsObjects["fixture-trailer"] = ScanField{Type: "barcodeCarLicScan", CustomFieldName: "Scan Trailer 1 Disk", CarLicense: j.Trailer}
	// Historical fixture scans must not supply this inspection's observed value.
	delete(e.CustomFieldsObjects, "fixture-seal")
	return e
}
