package main

import (
	_ "embed"
	"encoding/json"
	"sort"
	"strings"
)

//go:embed fixtures/demo_entries.json
var demoEntriesJSON []byte

// All values are independently authored fictional fixtures.
func demoEntry(scenario string) Entry {
	var fixture struct {
		ListOfEntries []Entry `json:"listOfEntries"`
	}
	if err := json.Unmarshal(demoEntriesJSON, &fixture); err != nil {
		panic(err)
	}
	index := map[string]int{"valid": 0, "expired": 1, "blocked": 2}[scenario]
	return fixture.ListOfEntries[index]
}

// A small display projection; no private custom-field values are forwarded.
type EntryPresentation struct {
	Direction   string `json:"direction"`
	Checkpoint  string `json:"checkpoint"`
	Profile     string `json:"profile"`
	Category    string `json:"category"`
	Company     string `json:"company"`
	Driver      string `json:"driver"`
	FleetNumber string `json:"fleetNumber"`
	Vehicle     string `json:"vehicle"`
	Trailer     string `json:"trailer"`
	Destination string `json:"destination"`
	Seal        string `json:"seal"`
}

func fallback(value, other string) string {
	if strings.TrimSpace(value) == "" {
		return other
	}
	return value
}
func presentEntry(e Entry) EntryPresentation {
	direction := map[string]string{"in": "ENTRY", "out": "EXIT"}[e.Type]
	p := EntryPresentation{
		Direction: fallback(direction, "UNKNOWN"), Checkpoint: fallback(e.DeviceName, "Checkpoint"),
		Profile: fallback(e.ProfileName, "Unspecified profile"), Category: fallback(e.Visitor.Category, "Unspecified category"),
		Company: fallback(e.Company, fallback(e.Visitor.Company, "Not supplied")),
		Driver:  "Not supplied", FleetNumber: fallback(e.Visitor.VisitorFields["Fleet No"].Value, "Not supplied"),
		Vehicle: fallback(e.CustomFields["Type of Truck"], "Not supplied"),
		Trailer: "Not supplied", Destination: fallback(e.CustomFields["Destination For CLDA 1"], "Not supplied"), Seal: "Not supplied",
	}
	// GateLens can put trailer scans in customFieldsObjects while carLicScans is empty.
	// Sort keys for stable rendering when multiple scan fields exist.
	keys := make([]string, 0, len(e.CustomFieldsObjects))
	for key := range e.CustomFieldsObjects {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		f := e.CustomFieldsObjects[key]
		if f.Type == "barcodeDriverLicScan" && p.Driver == "Not supplied" {
			p.Driver = fallback(strings.TrimSpace(f.DriverInitials+" "+f.DriverLastName), "Not supplied")
		}
		if f.Type == "barcodeCarLicScan" && f.CustomFieldName == "Scan Trailer 1 Disk" {
			p.Trailer = fallback(f.CarLicense, "Not supplied")
		}
		if f.Type == "barcodePlain" && f.CustomFieldName == "Scan Seal For CLDA 1" {
			p.Seal = fallback(f.Text, "Not supplied")
		}
	}
	return p
}
