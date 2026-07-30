import axios from 'axios';
const BASE_URL = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w";
const HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en-IN;q=0.9,en;q=0.8",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Google Chrome\";v=\"150\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "Referer": "https://www.bseindia.com/"
};

async function run() {
    const today = new Date();
    const yyyymmddToday = today.toISOString().split('T')[0].replace(/-/g, '');
    const params = {
        "pageno": 1,
        "strCat": "-1",
        "strPrevDate": yyyymmddToday,
        "strScrip": "",
        "strSearch": "P",
        "strToDate": yyyymmddToday,
        "strType": "C",
        "subcategory": "-1"
    };
    try {
        const response = await axios.get(BASE_URL, { params, headers: HEADERS });
        console.log(`Page 1 returned ${response.data.Table ? response.data.Table.length : 0} records.`);
        if (response.data.Table && response.data.Table.length > 0) {
            console.log('First record NEWSID:', response.data.Table[0].NEWSID);
            console.log('First record date:', response.data.Table[0].NEWS_DT);
        }
    } catch(e) {
        console.error(e.message);
    }
}
run();
