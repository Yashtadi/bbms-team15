# Deviations from SRS / SAD / STP

Add a row whenever the implementation differs from a submitted document.

| Date | Document & section | What changed | Why |
|---|---|---|---|
| 2026-10-27 | SRS §4.2 (BBMS-F-010), SAD data model (`donations`, `blood_units`) | Added `donations.donation_type` (`WHOLE_BLOOD` / `APHERESIS`). An apheresis session creates one `PLATELETS` unit with a 5-day shelf life; whole blood creates a `WHOLE_BLOOD` unit with 35 days. *Pending team confirmation.* | F-010 requires recording the donation type, but the schema had no column for it, and `blood_units.component` has no apheresis value. Single-donor platelets are the most common apheresis product. |
