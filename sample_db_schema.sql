CREATE TABLE "company_stock"(
    "FinInstrmId" BIGINT NOT NULL,
    "TradDt" DATE NULL,
    "BizDt" DATE NULL,
    "Sgmt" VARCHAR(10) NULL,
    "Src" VARCHAR(10) NULL,
    "FinInstrmTp" VARCHAR(10) NULL,
    "ISIN" VARCHAR(12) NULL,
    "TckrSymb" VARCHAR(20) NULL,
    "SctySrs" VARCHAR(10) NULL,
    "XpryDt" DATE NULL,
    "FininstrmActlXpryDt" DATE NULL,
    "StrkPric" DECIMAL(14, 4) NULL,
    "OptnTp" VARCHAR(2) NULL,
    "FinInstrmNm" VARCHAR(255) NULL,
    "LastPric" DECIMAL(14, 4) NULL,
    "OpnIntrst" BIGINT NULL,
    "ChngInOpnIntrst" BIGINT NULL,
    "TtlTradgVol" BIGINT NULL,
    "TtlTrfVal" DECIMAL(24, 4) NULL,
    "TtlNbOfTxsExctd" BIGINT NULL,
    "SsnId" VARCHAR(10) NULL,
    "NewBrdLotQty" BIGINT NULL
);
ALTER TABLE
    "company_stock" ADD PRIMARY KEY("FinInstrmId");
CREATE INDEX "company_stock_tckrsymb_index" ON
    "company_stock"("TckrSymb");
CREATE TABLE "historical_prices"(
    "FinInstrmId" BIGINT NOT NULL,
    "record_date" DATE NOT NULL,
    "open_price" DECIMAL(14, 6) NULL,
    "high_price" DECIMAL(14, 6) NULL,
    "low_price" DECIMAL(14, 6) NULL,
    "close_price" DECIMAL(14, 6) NULL,
    "adj_close" DOUBLE PRECISION NULL,
    "volume" BIGINT NULL,
    "dividends" DECIMAL(10, 4) NULL,
    "stock_splits" DECIMAL(10, 4) NULL
);
ALTER TABLE
    "historical_prices" ADD PRIMARY KEY("FinInstrmId");
ALTER TABLE
    "historical_prices" ADD PRIMARY KEY("record_date");
ALTER TABLE
    "historical_prices" ADD CONSTRAINT "historical_prices_fininstrmid_foreign" FOREIGN KEY("FinInstrmId") REFERENCES "company_stock"("FinInstrmId");