export interface CompanyStock {
  FinInstrmId: string; // BIGINT mapping
  TradDt?: Date;
  BizDt?: Date;
  Sgmt?: string;
  Src?: string;
  FinInstrmTp?: string;
  ISIN?: string;
  TckrSymb?: string;
  SctySrs?: string;
  XpryDt?: Date;
  FininstrmActlXpryDt?: Date;
  StrkPric?: number;
  OptnTp?: string;
  FinInstrmNm?: string;
  LastPric?: number;
  OpnIntrst?: string;
  ChngInOpnIntrst?: string;
  TtlTradgVol?: string;
  TtlTrfVal?: number;
  TtlNbOfTxsExctd?: string;
  SsnId?: string;
  NewBrdLotQty?: string;
}

export interface HistoricalPrice {
  FinInstrmId: string;
  record_date: Date;
  open_price?: number;
  high_price?: number;
  low_price?: number;
  close_price?: number;
  adj_close?: number;
  volume?: string;
  dividends?: number;
  stock_splits?: number;
}

export interface BseIndex {
  sccode: string;
  scname: string;
}

export interface IndexGraphHeader {
  currDate?: string;
  PreClose?: string;
  MinLow?: string;
  MaxLow?: string;
  Scrip?: string;
  LatestVal?: string;
  LatestTime?: string;
  source?: string;
}

export interface IndexHistoryPoint {
  date: string;
  value: string;
  session: 'preopen' | 'regular';
}
