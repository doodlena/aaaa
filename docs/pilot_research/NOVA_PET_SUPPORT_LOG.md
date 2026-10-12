# NoVA pet support: research log (2026-10-12)

Output: `data/sources/nova_pet_support.json`, with 23 unverified candidate records. There was no earlier version of this file, so it was created new.

Scope covers pet food pantries, low-cost or income-based veterinary, vaccine and spay/neuter programs, pet supplies, and temporary pet housing in a crisis. That last category is coded as `service_type: "other"`. The area is Arlington, Alexandria, Falls Church, Fairfax County, City of Fairfax, Loudoun, Prince William, Manassas and Manassas Park.

## Method

- Each page was fetched once with `curl`, using the user agent `OpenShelf-research/0.1` and a pause of at least 1.2 s between requests. robots.txt was checked for every host. Crawl-delay was honored: 10 s for pwspca.org and spcanova.org, and 20 s for petsofthehomeless.org. HTML was converted to text locally.
- Every field comes from a page fetched in this session. `raw_hours_text` and `raw_eligibility_text` are verbatim excerpts, joined with "..." where text was skipped. They were checked programmatically against the fetched text.
- Addresses were geocoded with the US Census geocoder (Public_AR_Current) and then tested with shapely against `data/boundaries/nova_localities_tigerweb.geojson`. All matched points fell inside NoVA, and none were dropped.
- Census returned **no match** for 8875 Lorton Road (Lorton), 4621 Legato Road (Fairfax), 42225 Adoption Drive (Leesburg) and 24757 Arcola Mills Drive (Dulles). Those records have no lat/lon. The Sugarland Elementary mobile pantry has no street address on its source page, so it was not geocoded.
- Weekday numbering is 0 = Monday. `week_of_month` is set for the Loudoun mobile pantries (2nd Monday and 3rd Thursday). Schedules are included only where the source states them explicitly.
- `needs_primary_confirmation: true` is set where data comes from a third party, the location or schedule is ambiguous, or the offering is unconfirmed.

## Sources consulted

| Host / URL | Status | Records |
|---|---|---|
| www.awla.org: pet-support-pantry, clinics, communitycare, spay-neuter-vouchers, veterinary-assistance, help-program | 200 | 6 |
| www.fairfaxcounty.gov/animalservices: petresources, spay-and-neuter-voucher-program, vaccine-and-microchip-clinic, locations, PetHaven, financial, spayneuter | 200 | 5 |
| hsfc.org: home, outreach, ani-meals-program, hours-and-directions, area-organizations-providing-pet-assistance | 200 | 1 |
| www.loudoun.gov: /3020/Pet-Pantry, /3906/Low-Cost-Resources | 200 | 5 |
| anicira.org: locations/anicira-manassas, manassas-financial-assistance | 200 | 1 |
| pwspca.org: /food/, /resources-2/ | 200 (crawl-delay 10) | 3 (PWC shelter pantry, SERVE, Manassas City AAC; all third-party, unconfirmed) |
| www.pwcva.gov/department/animal-services: contact-us, surrendering-pet, pet-care-emergencies | 200 for pages. robots.txt returned 403, which was treated as no rules. | supporting only (hours). No pet pantry page was found. |
| spcanova.org/pet-food-insecurity/ | 200 (crawl-delay 10) | 0 (directory only; Spay Inc. has no service address) |
| petsofthehomeless.org: 4 location listings | 200 (crawl-delay 20) | 2 (AWL Alexandria, Dulles South Food Pantry), plus supporting notes |
| dsfp.org: home, get-assistance | 200 | supporting only. The site does not mention pet food. |
| **alexandriaanimals.org** (Animal Welfare League of Alexandria) | **BLOCKED (HTTP 403 on robots.txt and homepage)** | 0 primary. The record relies on the Pets of the Homeless listing. |
| **www.actspwc.org** (ACTS food assistance; PW SPCA donates pet food there) | **BLOCKED (HTTP 403)** | 0 |
| **loudounhunger.org** (Loudoun Hunger Relief, the Loudoun Pet Pantry partner) | **BLOCKED (HTTP 403)** | 0 primary. The LHR record relies on loudoun.gov. |
| www.nvfs.org (SERVE pantry info) | not fetched; it returned 403 in earlier research this session | 0 |

No blocked host was retried with any other tool or client.

## Gaps and caveats

- **Alexandria:** the AWL Alexandria pantry, its AniMeals senior delivery, the spay/neuter voucher program and the monthly vaccine clinics could not be verified because the site is blocked. A person should download https://alexandriaanimals.org/communitypetpantry/ and /programs-and-services/snassist/ manually.
- **Prince William:** pwcva.gov has no pet pantry page. Pantry information for the county shelter comes only from the PW SPCA and Pets of the Homeless. The PW SPCA page lists different shelter hours than pwcva.gov.
- **Anicira:** its own pages say Sashi's Fund is for Medicaid-qualified residents. The PW SPCA says the fund uses 150% of the Federal Poverty Level or SNAP/Medicaid. Both versions are recorded in notes. The PW SPCA also says Anicira is not accepting new medical or wellness clients.
- **Fairfax vaccine clinics:** the page lists Friday and Wednesday dates without saying which goes with Lorton and which with Fire Station 40. Dates are kept in `raw_hours_text` with no structured schedule. The Frey Campus at 4500 West Ox Rd is listed as temporarily closed.
- **Dulles South Food Pantry:** Pets of the Homeless lists it as a pet food provider, but its address and schedule conflict with dsfp.org, and dsfp.org does not mention pet food. It is marked `unconfirmed`.
- **Pet-friendly shelters:** none were found in public sources. The crisis pet housing programs are AWLA H.E.L.P. and Fairfax PetHaven. PetHaven is a program at the public county shelter, not a confidential DV shelter address.
- Fairfax financial-aid and spay/neuter lists, the HSFC area list, and the AWLA referral lists mostly name national funds or providers outside NoVA. These were not imported.
