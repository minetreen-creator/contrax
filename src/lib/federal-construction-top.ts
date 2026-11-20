/**
 * The three largest federal construction contracts in each state, fiscal year 2025 (owner 2026-11-20:
 * a page per state for the winners list). Same USAspending.gov pull as federal-construction.ts
 * (2026-11-19): new awards first signed 2024-10-01 to 2025-09-30, NAICS sector 23, by the state
 * where the work is done. Row: [winner, winner's registered city and state, dollars, agency,
 * city where the work is done]. Names are as the record gives them (capitals); tidy at display.
 */
export const FEDERAL_CONSTRUCTION_TOP: Readonly<Record<string, ReadonlyArray<readonly [string, string, number, string, string]>>> = {
  AK: [
    ["KIEWIT INFRASTRUCTURE WEST CO.", "VANCOUVER, WA", 399443425, "Department of the Army", "NOME"],
    ["ASRC BUILDERS-CADDELL, LLC", "ANCHORAGE, AK", 240983218, "Department of the Army", "JBER"],
    ["GILBANE FEDERAL", "CONCORD, CA", 53735552, "Department of the Air Force", "KING SALMON"],
  ],
  AL: [
    ["BRASFIELD & GORRIE LLC", "BIRMINGHAM, AL", 147588356, "Federal Bureau of Investigation", "BIRMINGHAM"],
    ["HENSEL PHELPS CONSTRUCTION CO", "ORLANDO, FL", 56075016, "Department of the Army", "HUNTSVILLE"],
    ["HURLEY JV, LLP", "COLORADO SPRINGS, CO", 44948296, "Department of Veterans Affairs", "TUSCALOOSA"],
  ],
  AR: [
    ["BARNARD CONSTRUCTION COMPANY, INCORPORATED", "BOZEMAN, MT", 109151911, "Department of the Army", "TICHNOR"],
    ["HURLEY JV, LLP", "COLORADO SPRINGS, CO", 42895816, "Department of Veterans Affairs", "FAYETTEVILLE"],
    ["MEDVOLT - ROUNDHOUSE JV", "KANSAS CITY, MO", 34546038, "Departmental Offices", "HOT SPRINGS NATIONAL PARK"],
  ],
  AZ: [
    ["BCCG A JOINT VENTURE", "MONTGOMERY, AL", 658256189, "U.S. Customs and Border Protection", "SAN LUIS"],
    ["FISHER SAND & GRAVEL CO", "TEMPE, AZ", 352421800, "U.S. Customs and Border Protection", "SONOITA"],
    ["BFBC LLC", "BOZEMAN, MT", 180803157, "Department of the Army", "YUMA"],
  ],
  CA: [
    ["FISHER SAND & GRAVEL CO", "TEMPE, AZ", 1225325000, "U.S. Customs and Border Protection", "EL CENTRO"],
    ["BARNARD CONSTRUCTION COMPANY, INCORPORATED", "BOZEMAN, MT", 761628155, "Department of the Army", "PICO RIVERA"],
    ["BARNARD CONSTRUCTION COMPANY, INCORPORATED", "BOZEMAN, MT", 623149566, "Department of the Army", "CORONA"],
  ],
  CO: [
    ["GOSHAWK, LLC", "SAN ANTONIO, TX", 21064410, "Department of the Army", "COLORADO SPRINGS"],
    ["THE POVOLNY GROUP INC", "SAINT PAUL, MN", 14541385, "Department of Veterans Affairs", "GRAND JUNCTION"],
    ["NATIVE AMERICAN SERVICES CORP.", "KELLOGG, ID", 14037166, "Department of the Air Force", "COLORADO SPRINGS"],
  ],
  CT: [
    ["WEEKS-CASHMAN JV", "OMAHA, NE", 87838740, "Department of the Navy", "GROTON"],
    ["WHITING-TURNER CONTRACTING COMPANY, THE", "BALTIMORE, MD", 30159931, "U.S. Coast Guard", "NEW LONDON"],
    ["P & S CONSTRUCTION INC.", "NORTH CHELMSFORD, MA", 24557000, "Department of the Army", "WEST HAVEN"],
  ],
  DC: [
    ["CLARK CONSTRUCTION GROUP LLC", "BETHESDA, MD", 87652515, "Department of the Navy", "WASHINGTON"],
    ["RELIANCE CONSTRUCTION MANAGEMENT COMPANY", "CARY, NC", 17875023, "Department of the Army", "WASHINGTON"],
    ["VERSAR, INC.", "WASHINGTON, DC", 17147470, "Department of the Army", "WASHINGTON"],
  ],
  DE: [
    ["STAMPEDE VENTURES, INC.", "NOME, AK", 25725728, "Department of the Army", "DOVER AFB"],
    ["FDCD II JOINT VENTURE, LLC", "BRIDGEPORT, PA", 18885000, "Department of Veterans Affairs", "WILMINGTON"],
    ["CURTIN MARITIME CORP", "LONG BEACH, CA", 10833195, "Department of the Army", "MIDDLETOWN"],
  ],
  FL: [
    ["HEAD / DIAZ 2022", "COLUMBUS, OH", 101154198, "Department of the Navy", "KEY WEST"],
    ["ESA SOUTH, INC.", "CANTONMENT, FL", 81162205, "Department of Veterans Affairs", "PENSACOLA"],
    ["MANSON CONSTRUCTION CO", "SEATTLE, WA", 61080000, "Department of the Navy", "JACKSONVILLE"],
  ],
  GA: [
    ["ACC CONSTRUCTION CO., INC.", "AUGUSTA, GA", 166188978, "Department of the Army", "AUGUSTA"],
    ["ACC CONSTRUCTION CO., INC.", "AUGUSTA, GA", 97084901, "Department of the Army", "WARNER ROBINS"],
    ["J.E. DUNN CONSTRUCTION COMPANY", "KANSAS CITY, MO", 55337173, "Department of the Army", "MARIETTA"],
  ],
  HI: [
    ["HAWAII HARBORS CONSTRUCTORS JV", "AIEA, HI", 197969875, "Department of the Navy", "PEARL HARBOR"],
    ["NAN INC", "HONOLULU, HI", 134496543, "Department of the Navy", "PEARL HARBOR"],
    ["HENSEL PHELPS CONSTRUCTION CO", "HONOLULU, HI", 95548132, "Department of the Army", "FORT SHAFTER"],
  ],
  IA: [
    ["PERINI MANAGEMENT SERVICES, INC.", "FRAMINGHAM, MA", 35835161, "Department of the Army", "MIDDLETOWN"],
    ["J. F. BRENNAN COMPANY, INC.", "LA CROSSE, WI", 21967500, "Department of the Army", "KEOKUK"],
    ["COVENANT CONSTRUCTION SERVICES LLC", "CLIVE, IA", 19181217, "Department of Veterans Affairs", "DES MOINES"],
  ],
  ID: [
    ["WALSH FEDERAL LLC", "CHICAGO, IL", 78401653, "Federal Aviation Administration", "POCATELLO"],
    ["LACY MECHANICAL INC", "BOISE, ID", 10746586, "Bureau of Land Management", "SHOSHONE"],
    ["ALPINE CONSTRUCTION MANAGEMENT LLC", "BOISE, ID", 5748586, "Department of Veterans Affairs", "BUHL"],
  ],
  IL: [
    ["BRIDGER RICHARD JV LLC", "CHICAGO, IL", 34988380, "Department of Veterans Affairs", "DANVILLE"],
    ["JOSEPH J HENDERSON & SON INC", "GURNEE, IL", 25339799, "Department of the Navy", "GREAT LAKES"],
    ["BLUE PACIFIC II JV LLC", "CHICAGO, IL", 15026946, "Department of Veterans Affairs", "CHICAGO"],
  ],
  IN: [
    ["KMC SOLUTIONS, LLC", "HAMPTON, VA", 20527777, "Department of Veterans Affairs", "MARION"],
    ["PLACE SERVICES INCORPORATED", "CANTON, GA", 17179200, "Department of the Army", "GRISSOM ARB"],
    ["HOWARD W. PENCE, INC.", "ELIZABETHTOWN, KY", 12975847, "Department of the Army", "TERRE HAUTE"],
  ],
  KS: [
    ["HURLEY JV, LLP", "COLORADO SPRINGS, CO", 45904791, "Department of Veterans Affairs", "TOPEKA"],
    ["CITY LIGHT & POWER FTR, LLC", "GREENWOOD VILLAGE, CO", 25138241, "Department of the Army", "FORT RILEY"],
    ["FLOYD CONSTRUCTION CORP", "WICHITA, KS", 24402210, "Department of Veterans Affairs", "WICHITA"],
  ],
  KY: [
    ["VETERANS CONTRACTING, INC.", "CLEVELAND, OH", 12467574, "Department of Veterans Affairs", "FORT THOMAS"],
    ["LUHR CROSBY, LLC", "COLUMBIA, IL", 11037796, "Department of the Army", "LOUISVILLE"],
    ["SEMPER TEK INC", "LEXINGTON, KY", 10258765, "Department of Veterans Affairs", "LEXINGTON"],
  ],
  LA: [
    ["M.R. PITTMAN GROUP, L.L.C", "SAINT ROSE, LA", 51651112, "Department of the Army", "NEW ORLEANS"],
    ["BL HARBERT INTERNATIONAL LLC", "BIRMINGHAM, AL", 41381393, "Department of the Navy", "BARKSDALE AFB"],
    ["MANSON CONSTRUCTION CO", "SEATTLE, WA", 39050000, "Department of the Army", "NEW ORLEANS"],
  ],
  MA: [
    ["BILLY W. JARRETT CONSTRUCTION COMPANY, INC.", "PRATTVILLE, AL", 22063994, "Department of Veterans Affairs", "HYANNIS"],
    ["ATLAS PAINTING AND SHEETING CORP.", "AMHERST, NY", 19690000, "Department of the Army", "BUZZARDS BAY"],
    ["STRUCTURAL ASSOCIATES INC", "EAST SYRACUSE, NY", 18450810, "Department of the Army", "HANSCOM AFB"],
  ],
  MD: [
    ["CLARK CONSTRUCTION GROUP LLC", "BETHESDA, MD", 54023351, "National Institutes of Health", "BETHESDA"],
    ["CHICKASAW DEFENSE GROUP, LLC", "NORMAN, OK", 44581564, "Department of the Navy", "INDIAN HEAD"],
    ["EVCON-CWC JV LLC", "WASHINGTON, DC", 41102914, "Department of the Navy", "JB ANDREWS"],
  ],
  ME: [
    ["CIANBRO CORPORATION", "PITTSFIELD, ME", 99859864, "Department of the Navy", "KITTERY"],
    ["WHITING-TURNER CONTRACTING COMPANY, THE", "TOWSON, MD", 25386353, "Department of the Navy", "KITTERY"],
    ["J & J CONTRACTORS, INC.", "NORTH BILLERICA, MA", 23412000, "Department of the Navy", "CUTLER"],
  ],
  MI: [
    ["VETERANS ELECTRICAL GROUP LLC", "CLEVELAND, OH", 30463426, "Department of Veterans Affairs", "DETROIT"],
    ["VETSPACE CONSTRUCTION SERVICES, LLC", "CLEVELAND, OH", 29075345, "Department of Veterans Affairs", "IRON MOUNTAIN"],
    ["COMMERCIAL CONTRACTING CORP", "AUBURN HILLS, MI", 23777324, "Department of the Army", "WARREN"],
  ],
  MN: [
    ["MICHELS CONSTRUCTION, INC.", "BROWNSVILLE, WI", 16145971, "National Park Service", "INTERNATIONAL FALLS"],
    ["BCSS, LLC", "TEMPE, AZ", 10959417, "Department of the Army", "COMSTOCK"],
    ["HUOT CONSTRUCTION AND SERVICES, INC.", "SOUTH SAINT PAUL, MN", 6999383, "Federal Prison System / Bureau of Prisons", "SOUTH SAINT PAUL"],
  ],
  MO: [
    ["OCCI, INC.", "FULTON, MO", 41248895, "Department of the Army", "CLARKSVILLE"],
    ["STRUCTSURE PROJECTS INC", "KANSAS CITY, MO", 28556770, "Department of the Army", "KANSAS CITY"],
    ["STRUCTSURE PROJECTS INC", "KANSAS CITY, MO", 22405703, "Department of the Army", "KANSAS CITY"],
  ],
  MS: [
    ["ESTES BROS. CONST. INC.", "JONESVILLE, VA", 32592744, "Federal Highway Administration", "ETHEL"],
    ["BIRMINGHAM INDUSTRIAL CONSTRUCTION, LLC", "COLUMBIANA, AL", 31449888, "Department of the Army", "STENNIS SPACE CENTER"],
    ["AFFOLTER CONTRACTING COMPANY, INC", "LA MARQUE, TX", 19402996, "Department of the Army", "VICKSBURG"],
  ],
  MT: [
    ["SWANK ENTERPRISES, INC.", "VALIER, MT", 43107851, "Public Buildings Service", "BUTTE"],
    ["PAULSEN CONSTRUCTION LLC", "SALT LAKE CITY, UT", 27201807, "Departmental Offices", "GARDINER"],
    ["HAMILTON CONSTRUCTION CO", "SPRINGFIELD, OR", 16904108, "Federal Highway Administration", "AUGUSTA"],
  ],
  NC: [
    ["WALSH FEDERAL LLC", "CHICAGO, IL", 58007493, "Department of the Navy", "HAVELOCK"],
    ["ACC CONSTRUCTION CO., INC.", "AUGUSTA, GA", 43131514, "Department of the Army", "FORT BRAGG"],
    ["RQ CONSTRUCTION, LLC", "CARLSBAD, CA", 34016253, "U.S. Coast Guard", "ELIZABETH CITY"],
  ],
  ND: [
    ["HSG PARK JOINT VENTURE 2, LLC", "HARVEY, ND", 28049302, "Department of the Army", "HORACE"],
    ["DUBUQUE BARGE AND FLEETING SERVICE CO", "DUBUQUE, IA", 25401331, "Department of the Army", "COLEHARBOR"],
    ["UNITED CRANE AND EXCAVATION, INC.", "GRAND FORKS, ND", 19817205, "Department of the Air Force", "GRAND FORKS AFB"],
  ],
  NE: [
    ["SAMPSON CONSTRUCTION CO INC", "LINCOLN, NE", 25196589, "Department of the Army", "LINCOLN"],
    ["WASHINGTON EQUIPMENT MANUFACTURING COMPANY, INC.", "SPOKANE, WA", 10904784, "Department of the Army", "CROFTON"],
    ["RELIABLE CONTRACTING GROUP, LLC", "LOUISVILLE, KY", 9597796, "Department of the Army", "OFFUTT AFB"],
  ],
  NH: [
    ["CMS CORPORATION", "BARGERSVILLE, IN", 20070926, "Department of the Air Force", "CONCORD"],
    ["AMERITECH CONTRACTING LLC", "BERLIN, CT", 13675939, "Department of Veterans Affairs", "MANCHESTER"],
    ["AMERITECH CONTRACTING LLC", "MIDDLETOWN, CT", 6132526, "Department of Veterans Affairs", "MANCHESTER"],
  ],
  NJ: [
    ["DONJON MARINE CO., LLC", "HILLSIDE, NJ", 82097890, "Department of the Army", "NEWARK"],
    ["GREAT LAKES DREDGE & DOCK CO, LLC", "HOUSTON, TX", 75050896, "Department of the Army", "MANASQUAN"],
    ["ANSELMI & DE CICCO, INC.", "MAPLEWOOD, NJ", 69773732, "Department of the Army", "BELFORD"],
  ],
  NM: [
    ["JAYNES CORPORATION", "ALBUQUERQUE, NM", 173260336, "Indian Health Service", "CROWNPOINT"],
    ["SGS LLC", "YUKON, OK", 25989820, "Department of the Army", "WHITE SANDS MISSILE RANGE"],
    ["MGC CONTRACTORS INC", "PHOENIX, AZ", 15810866, "Bureau of Reclamation", "ALAMOGORDO"],
  ],
  NV: [
    ["KORTE CONSTRUCTION COMPANY", "SAINT LOUIS, MO", 106114818, "Department of the Army", "INDIAN SPRINGS"],
    ["HARPER CONSTRUCTION COMPANY, INC.", "SAN DIEGO, CA", 42994000, "Department of the Navy", "FALLON"],
    ["WU & ASSOCIATES INC", "MOUNT LAUREL, NJ", 32115298, "Department of the Army", "NELLIS AFB"],
  ],
  NY: [
    ["MURNANE BUILDING CONTRACTORS, INC.", "PLATTSBURGH, NY", 47420748, "Public Buildings Service", "ROUSES POINT"],
    ["AMERIFIELD JV LLC", "BERLIN, CT", 45603497, "Department of Veterans Affairs", "NORTHPORT"],
    ["VOLMAR CONSTRUCTION INC", "BROOKLYN, NY", 31548178, "Public Buildings Service", "NEW YORK"],
  ],
  OH: [
    ["INTERNATIONAL TOWERS LLC", "SAINT IGNATIUS, MT", 42996284, "Department of the Army", "COLUMBUS"],
    ["PULLMAN SST, INC.", "COLUMBIA, MD", 27151797, "National Park Service", "PUT IN BAY"],
    ["MESSER CONSTRUCTION CO", "CINCINNATI, OH", 16347121, "Department of the Army", "DAYTON"],
  ],
  OK: [
    ["BL HARBERT INTERNATIONAL LLC", "BIRMINGHAM, AL", 272704779, "Department of the Army", "OKLAHOMA CITY"],
    ["HARPER CONSTRUCTION COMPANY, INC.", "SAN DIEGO, CA", 108568804, "Department of the Army", "OKLAHOMA CITY"],
    ["KRE JV, LLC", "IVINS, UT", 97756050, "Department of the Army", "MCALESTER"],
  ],
  OR: [
    ["MANSON CONSTRUCTION CO", "SEATTLE, WA", 29904165, "Department of the Army", "PORTLAND"],
    ["PORT OF PORTLAND", "PORTLAND, OR", 25357809, "Department of the Army", "PORTLAND"],
    ["GRIFFIN CONSTRUCTION, LLC", "PRINEVILLE, OR", 22541694, "Indian Health Service", "WARM SPRINGS"],
  ],
  PA: [
    ["WHITING-TURNER CONTRACTING COMPANY, THE", "TOWSON, MD", 114961115, "Department of the Navy", "PHILADELPHIA"],
    ["JBW GROUP LLC", "FORT WORTH, TX", 73073803, "Department of the Army", "NEW CUMBERLAND"],
    ["BRIDGER RICHARD JV LLC", "CHICAGO, IL", 47279808, "Department of Veterans Affairs", "LEBANON"],
  ],
  RI: [
    ["BILLY W. JARRETT CONSTRUCTION COMPANY, INC.", "PRATTVILLE, AL", 15258062, "Department of Veterans Affairs", "PROVIDENCE"],
    ["CCI UTILITY AND CONSTRUCTION SERVICES, LLC", "ANCHORAGE, AK", 5898655, "Department of the Navy", "NEWPORT"],
    ["J & J CONTRACTORS, INC.", "NORTH BILLERICA, MA", 3707000, "Department of the Navy", "NEWPORT"],
  ],
  SC: [
    ["GREAT LAKES DREDGE & DOCK CO, LLC", "HOUSTON, TX", 75353571, "Department of the Army", "CHARLESTON"],
    ["WALSH FEDERAL LLC", "CHICAGO, IL", 60723094, "Federal Aviation Administration", "CHARLESTON"],
    ["OUTSIDE BOX LLC", "RICHMOND, VA", 24571957, "Department of the Air Force", "GOOSE CREEK"],
  ],
  SD: [
    ["FEDERAL CONTRACTING INC", "COLORADO SPRINGS, CO", 59729213, "Department of the Army", "RAPID CITY"],
    ["SAW GREENLAND, LLC", "VIRGINIA BCH, VA", 34638080, "Department of Veterans Affairs", "SIOUX FALLS"],
    ["CONTI FEDERAL SERVICES, LLC", "ORLANDO, FL", 33497794, "Department of the Army", "ELLSWORTH AFB"],
  ],
  TN: [
    ["PARSONS GOVERNMENT SERVICES INC", "PASADENA, CA", 176032926, "Department of the Army", "KINGSPORT"],
    ["SALAS O'BRIEN FEDERAL, LLC", "KATY, TX", 44150111, "Department of the Army", "DRUMMONDS"],
    ["SAW GREENLAND, LLC", "VIRGINIA BCH, VA", 41222156, "Department of Veterans Affairs", "MOUNTAIN HOME"],
  ],
  TX: [
    ["BCCG A JOINT VENTURE", "MONTGOMERY, AL", 873510389, "U.S. Customs and Border Protection", "WESLACO"],
    ["BARNARD SPENCER JOINT VENTURE", "BOZEMAN, MT", 708550367, "U.S. Customs and Border Protection", "WESLACO"],
    ["BCCG A JOINT VENTURE", "MONTGOMERY, AL", 572654700, "U.S. Customs and Border Protection", "WESLACO"],
  ],
  UT: [
    ["HSGS-AMERESCO, LLC", "SUMMERVILLE, SC", 201638619, "Department of Veterans Affairs", "SALT LAKE CITY"],
    ["AMES FEDERAL CONTRACTING GROUP LLC", "BURNSVILLE, MN", 115063658, "Bureau of Reclamation", "HYRUM"],
    ["HHI CORPORATION", "OGDEN, UT", 58080326, "Department of the Army", "HILL AFB"],
  ],
  VA: [
    ["RQ CONSTRUCTION, LLC", "CARLSBAD, CA", 122430246, "Department of the Navy", "PORTSMOUTH"],
    ["SGJV2, LLC", "VIRGINIA BEACH, VA", 78077778, "Department of Veterans Affairs", "VIRGINIA BEACH"],
    ["SAUER CONSTRUCTION, LLC", "JACKSONVILLE, FL", 72215324, "Department of the Navy", "VIRGINIA BEACH"],
  ],
  VT: [
    ["SCHROEDER CONSTRUCTION MANAGEMENT INC", "NASHUA, NH", 4006006, "Public Buildings Service", "DERBY"],
    ["ELEVATED TECHNOLOGIES SERVICES, LLC", "CHARLESTON, SC", 3475089, "Public Buildings Service", "BURLINGTON"],
    ["TURNER & TOWNSEND HEERY, LLC", "ATLANTA, GA", 3321601, "Public Buildings Service", "RICHFORD"],
  ],
  WA: [
    ["KIEWIT-ALBERICI SIOP MACC AJV", "VANCOUVER, WA", 517591409, "Department of the Navy", "BREMERTON"],
    ["FLATIRON-AECON JOINT VENTURE", "RENTON, WA", 336833587, "Department of the Army", "RAVENSDALE"],
    ["CONTRACK WATTS INC", "MC LEAN, VA", 182997000, "Department of the Navy", "MANCHESTER"],
  ],
  WI: [
    ["U.S. VET GENERAL CONTRACTING, LLC", "MC FARLAND, WI", 13562897, "Department of Veterans Affairs", "MADISON"],
    ["ROEN SALVAGE CO.", "STURGEON BAY, WI", 11702581, "Department of the Army", "ALGOMA"],
    ["KPH CONSTRUCTION CORP", "MILWAUKEE, WI", 8484567, "Department of the Army", "CAMP DOUGLAS"],
  ],
  WV: [
    ["AMVET RITZ JV LLC", "BALTIMORE, MD", 15409619, "Department of Veterans Affairs", "MARTINSBURG"],
    ["AMS INDUSTRIAL LLC", "LAFAYETTE, CO", 9481344, "Department of the Army", "KEYSER"],
    ["EIGHTY-NINE ENTERPRISES LLC", "INWOOD, WV", 8769497, "Department of Veterans Affairs", "MARTINSBURG"],
  ],
  WY: [
    ["RECORD STEEL AND CONSTRUCTION, INC.", "BOISE, ID", 46195805, "National Park Service", "YELLOWSTONE NATIONAL PARK"],
    ["BRIDGER NATIONAL CONSTRUCTION LLC", "CHICAGO, IL", 21190712, "Department of Veterans Affairs", "CHEYENNE"],
    ["RECCO INC", "CHEYENNE, WY", 17336000, "Department of the Army", "FE WARREN AFB"],
  ],
};
