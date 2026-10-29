package main

import "testing"

func TestDispatchFixtureKeepsPrimaryPlateSeparateFromTrailer(t *testing.T) {
	e := demoEntry("valid")
	p := presentEntry(e)
	if len(e.CarLicScans) != 0 {
		t.Fatal("fixture must exercise empty carLicScans")
	}
	if e.Licence != e.Visitor.CarLic || e.Licence == p.Trailer {
		t.Fatal("primary and trailer plates confused")
	}
	if p.Driver != "A. Morgan" || p.Direction != "EXIT" || p.FleetNumber != "041" || p.Destination != "Cold store B" || p.Seal != "CG-24081" {
		t.Fatalf("unexpected projection: %+v", p)
	}
	e.CustomFieldsObjects = nil
	e.CustomFields = nil
	e.Visitor.VisitorFields = nil
	p = presentEntry(e)
	if p.Driver != "Not supplied" || p.Trailer != "Not supplied" || p.Seal != "Not supplied" {
		t.Fatal("missing scans must not invent results")
	}
}

func TestHistoryFieldsDoNotGrantLocalAuthorization(t *testing.T) {
	s, now := fixture()
	scan(t, s, now)
	s.state.DemoAuthorization.ValidTill = now.UnixMilli()
	s.state.Entry.IsBlocked = false
	s.state.Entry.CustomFields["Allow"] = "Yes"
	if decision, _ := s.decision(); decision != "expired" {
		t.Fatal("record fields must not bypass current policy")
	}
	if s.state.Entry.Visitor.IsOnSite != true {
		t.Fatal("fixture should represent vehicle waiting on site for exit")
	}
}
