# Fictional data, preserved field structure

The demo keeps the field names, JSON types and nesting of the subset it consumes: `licence`, `visitor`, `carLicScans`, `customFields`, `customFieldsObjects`, driver/trailer scan fields and dispatch labels such as `Destination For CLDA 1`. Enum/discriminator values such as `in`, `out`, `barcodeCarLicScan` and `appType` are structural labels, not credentials or customer identity.

People, companies, destinations, identifiers, registrations and seal numbers are independently authored fictional values. They are stable fixtures rather than fresh random values on each request, so references and test results remain reproducible. A vehicle plate is consistent across `entry.licence`, `visitor.carLic` and `visitor.carLicSet`. A trailer plate remains a different field. These invented strings are not guaranteed to be reserved real-world registrations.

`services/access-demo/fixtures/demo_entries.json` supplies the supported entry shape. `inspection_jobs.json` defines six fictional tasks and their reference conditions. This is a focused subset, not a complete export or a production API implementation. Raw exports, original photos, private URLs, customer identifiers and application source from other repositories are not included.

| Source field | Display meaning |
| --- | --- |
| `entry.licence` | Primary vehicle plate |
| `entry.type` | ENTRY / EXIT |
| `entry.deviceName` | Checkpoint |
| `entry.profileName` | Assignment profile |
| `visitor.category` | Vehicle category |
| `entry.company` / `visitor.company` | Fictional company |
| `visitor.visitorFields['Fleet No'].value` | Fleet number |
| `customFieldsObjects` / `barcodeDriverLicScan` | Driver |
| `customFieldsObjects` / `Scan Trailer 1 Disk` | Trailer plate |
| `customFields['Destination For CLDA 1']` | Destination |

Missing values display `Not supplied`; missing data must not silently authorize access. Historical scan fields do not provide the current observed seal. The expected number comes from the fictional job, while the observed number is empty until local photo recognition succeeds.

The `sceneSeal` field paints the synthetic label. It is never passed to OCR. `expectedSeal` is a comparison reference only. Arrival registration has no expected value and cannot be reported as a match. The incident and evidence endpoints are local demo extensions, not claims of production compatibility.
