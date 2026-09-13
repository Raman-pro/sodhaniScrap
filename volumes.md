Currently the project uses the price history api to get the volume I want you to create a new worker for fetching the volumes of stocks part but it will also require creating a new table one is bse_volume_history and other is nse_volume_history what we want for the new worker that is npm run start:volume is to download bhavcopy

For BSE: www.bseindia.com/BSEDATA/gross/2026/SCBSEALL1109.zip at around 5-6 pm I don't know when the bhavcopy release so check online when do bhavcopy get's released preferably do download this file every day and like try 2-3 time between 5-6 pm if unable to download also like replace the year and date with today's date and year the 1109 in the day of today like 11th sept and also the year 2026 also this file downloads a zip so extract it get the txt file and look into the txt file format to extract.

For NSE: nsearchives.nseindia.com/products/content/sec_bhavdata_full_11092026.csv in this also change the date according to the current

Moreover I want you to store all the previous volume data from company_stock

as the previous company_stock doesn't have other part of bhavcopy data like it has you can leave them with null values

**From the bhavcopy you must take the values related to volumes only.**