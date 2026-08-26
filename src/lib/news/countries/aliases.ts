export interface CountrySignals {
  code: string;
  names: string[];
  locations: string[];
  isoCodes?: string[];
  ambiguous?: boolean;
}

export const COUNTRY_SIGNALS: CountrySignals[] = [
  { code: "JP", names: ["Japan", "Japanese"], locations: ["Tokyo", "Osaka", "Kyoto"], isoCodes: ["JP", "JPN"] },
  { code: "SG", names: ["Singapore", "Singaporean", "S'pore", "S’pore"], locations: ["Singapore City"], isoCodes: ["SG", "SGP"] },
  { code: "US", names: ["United States", "United States of America", "American", "U.S."], locations: ["Washington, D.C.", "New York City"], isoCodes: ["US", "USA"] },
  { code: "CN", names: ["China", "Chinese"], locations: ["Beijing", "Shanghai", "Shenzhen"], isoCodes: ["CN", "CHN"] },
  { code: "GB", names: ["United Kingdom", "British", "Britain"], locations: ["London", "Edinburgh"], isoCodes: ["UK", "GBR"] },
  { code: "FR", names: ["France", "French"], locations: ["Paris", "Marseille"], isoCodes: ["FR", "FRA"] },
  { code: "DE", names: ["Germany", "German"], locations: ["Berlin", "Frankfurt", "Munich"], isoCodes: ["DE", "DEU"] },
  { code: "IN", names: ["India", "Indian"], locations: ["New Delhi", "Mumbai", "Bengaluru"], isoCodes: ["IN", "IND"] },
  { code: "KR", names: ["South Korea", "Korean"], locations: ["Seoul", "Busan"], isoCodes: ["KR", "KOR"] },
  { code: "KP", names: ["North Korea", "North Korean"], locations: ["Pyongyang"], isoCodes: ["KP", "PRK"] },
  { code: "AU", names: ["Australia", "Australian"], locations: ["Canberra", "Sydney", "Melbourne"], isoCodes: ["AU", "AUS"] },
  { code: "NZ", names: ["New Zealand", "New Zealander"], locations: ["Wellington", "Auckland"], isoCodes: ["NZ", "NZL"] },
  { code: "ID", names: ["Indonesia", "Indonesian"], locations: ["Jakarta", "Bali"], isoCodes: ["ID", "IDN"] },
  { code: "MY", names: ["Malaysia", "Malaysian"], locations: ["Kuala Lumpur", "Putrajaya"], isoCodes: ["MY", "MYS"] },
  { code: "PH", names: ["Philippines", "Filipino"], locations: ["Manila"], isoCodes: ["PH", "PHL"] },
  { code: "TH", names: ["Thailand", "Thai"], locations: ["Bangkok"], isoCodes: ["TH", "THA"] },
  { code: "VN", names: ["Vietnam", "Vietnamese"], locations: ["Hanoi", "Ho Chi Minh City"], isoCodes: ["VN", "VNM"] },
  { code: "BR", names: ["Brazil", "Brazilian"], locations: ["Brasilia", "Sao Paulo", "Rio de Janeiro"], isoCodes: ["BR", "BRA"] },
  { code: "CA", names: ["Canada", "Canadian"], locations: ["Ottawa", "Toronto", "Vancouver"], isoCodes: ["CA", "CAN"] },
  { code: "MX", names: ["Mexico", "Mexican"], locations: ["Mexico City"], isoCodes: ["MX", "MEX"] },
  { code: "ZA", names: ["South Africa", "South African"], locations: ["Pretoria", "Cape Town", "Johannesburg"], isoCodes: ["ZA", "ZAF"] },
  { code: "NG", names: ["Nigeria", "Nigerian"], locations: ["Abuja", "Lagos"], isoCodes: ["NG", "NGA"] },
  { code: "KE", names: ["Kenya", "Kenyan"], locations: ["Nairobi"], isoCodes: ["KE", "KEN"] },
  { code: "EG", names: ["Egypt", "Egyptian"], locations: ["Cairo"], isoCodes: ["EG", "EGY"] },
  { code: "UA", names: ["Ukraine", "Ukrainian"], locations: ["Kyiv", "Odesa"], isoCodes: ["UA", "UKR"] },
  { code: "RU", names: ["Russia", "Russian"], locations: ["Moscow", "St Petersburg"], isoCodes: ["RU", "RUS"] },
  { code: "IL", names: ["Israel", "Israeli"], locations: ["Jerusalem", "Tel Aviv"], isoCodes: ["IL", "ISR"] },
  { code: "PS", names: ["Palestine", "Palestinian"], locations: ["Gaza", "Ramallah"], isoCodes: ["PS", "PSE"] },
  { code: "SA", names: ["Saudi Arabia", "Saudi"], locations: ["Riyadh", "Jeddah"], isoCodes: ["SA", "SAU"] },
  { code: "AE", names: ["United Arab Emirates", "Emirati"], locations: ["Abu Dhabi", "Dubai"], isoCodes: ["UAE"] },
  { code: "TR", names: ["Türkiye", "Turkish"], locations: ["Ankara", "Istanbul"], isoCodes: ["TR", "TUR"], ambiguous: true },
  { code: "GE", names: ["Georgia's government", "Georgian government", "Republic of Georgia"], locations: ["Tbilisi", "Caucasus"], isoCodes: ["GE", "GEO"], ambiguous: true },
  { code: "JO", names: ["Jordanian"], locations: ["Amman"], isoCodes: ["JO", "JOR"], ambiguous: true },
];
