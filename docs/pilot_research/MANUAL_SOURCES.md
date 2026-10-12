# Sources to add by hand

These sites refused automated access (HTTP 403, a robots.txt rule, or an unreachable server) during research on
2026-10-12. We deliberately did **not** work around the blocks. A person can open each page normally in a browser.

**How to add one**
1. Open the page in your browser.
2. Save it (File → Save Page As, or download the PDF) into `data/sources/manual/`, for example
   `data/sources/manual/arlington-2026-food-flyer.pdf`.
3. Tell a developer, or Claude Code, which file it is. It gets parsed into cited records and imported, labelled "not
   yet verified" like everything else.

You can also call or email the organization and enter the details in Admin → Queue. That counts as a verified listing.

## Highest impact (each one adds many listings)

| # | Site | What it gives us | Area |
|---|---|---|---|
| 1 | Arlington County food assistance flyer (2026): https://www.arlingtonva.us/files/sharedassets/public/v/2/departments/documents/dhs/food-security/2-pager/english-2026-food-assistance-2-page-flyer.pdf | ~19 Arlington food sites | VA-08 |
| 2 | Arlington County food brochure (2025): https://www.arlingtonva.us/files/sharedassets/public/v/4/departments/documents/dhs/food-security/2025-food-brochure-english.pdf | ~6 more Arlington sites | VA-08 |
| 3 | Fairfax County senior centers: https://www.fairfaxcounty.gov/neighborhood-community-services/older-adults/senior-centers | Senior centers and meals | Fairfax |
| 4 | Fairfax County Human Services Resource Guide (data layer found; the county allows internal use only, so ask permission before public display) | ~760 service records | Fairfax |
| 5 | ACTS Prince William: https://www.actspwc.org/food-assistance/ | Major food pantry, home delivery, shelter, crisis help | Prince William |
| 6 | NVFS Hunger Resource Center / SERVE: https://www.nvfs.org/our-places/hunger-resource-center/ | Food pantry, shelter, family services | Manassas / PWC |
| 7 | Loudoun Hunger Relief: https://loudounhunger.org/ | Loudoun's main food bank and pet pantry details | Loudoun |
| 8 | City of Fairfax human services: https://www.fairfaxva.gov/ | City of Fairfax currently has almost no listings | City of Fairfax |

## Mental health, legal, and family services

| Site | What it gives us |
|---|---|
| NAMI Northern Virginia: https://nami-northernvirginia.org | Support groups, family programs |
| Legal Services of Northern Virginia: https://www.lsnv.org/ | Free legal aid offices (we currently have only secondary info) |
| Bridges to Independence: https://bridges2.org | Housing and family services (Arlington) |
| Loudoun Abused Women's Shelter (LAWS): https://lcsj.org/contact/ | Public office info only, never the shelter address |
| Dar Al-Hijrah social services: https://hijrah.org/services/social-services/ | Food and social services (Falls Church area) |

## Food pantries

| Site | Note |
|---|---|
| Columbia Baptist Church food pantry: https://columbiabaptist.org/foodpantry (also columbia.church) | Falls Church |
| West End Food Pantry: westendfoodpantry.com | Site returned 404; two different addresses appear in other listings, so call to confirm |
| United Community (Mount Vernon): unitedcommunityva.org / unitedcommunity.org/food/ | Domain didn't resolve; find the current site |
| Manassas Park food bank PDF: https://www.manassasparkva.gov/Social%20Services/Food%20Bank%20Resources.pdf | Blocked by the site's robots.txt rules; Manassas Park has only 1 listing |

## Pets

| Site | Note |
|---|---|
| Animal Welfare League of Alexandria pet pantry: https://alexandriaanimals.org/communitypetpantry/ | Currently sourced only from a secondary listing |

## Addresses the geocoders couldn't place (need a correct address)

From the pet and support research: Lorton, Legato Rd, Adoption Dr, and Arcola Mills addresses (pet services); Jim
Scott Senior Center; LSNV Fairfax office; Dulles South Food Pantry. Fix the address in Admin → Queue, or send the
correct one.
