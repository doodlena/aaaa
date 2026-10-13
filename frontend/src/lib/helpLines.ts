/**
 * General help lines shown site-wide. Each number was checked on the official page on 2026-10-12:
 * - 211 Virginia: https://www.211virginia.org/ ("Dial 2-1-1", "Text CONNECT to 247211")
 * - Fairfax County Coordinated Services Planning: fairfaxcounty.gov/neighborhood-community-services/coordinated-services-planning (703-222-0880)
 * - Arlington County DHS: arlingtonva.us/Government/Departments/DHS/Public-Assistance (703-228-1300, food assistance and homelessness)
 * - Alexandria DCHS: alexandriava.gov/DCHS (Call Center 703.746.5700)
 */
export const HELP_LINES = [
  { key: 'va211', tel: '211', label: '2-1-1' },
  { key: 'fairfax', tel: '7032220880', label: '(703) 222-0880' },
  { key: 'arlington', tel: '7032281300', label: '(703) 228-1300' },
  { key: 'alexandria', tel: '7037465700', label: '(703) 746-5700' },
] as const;
