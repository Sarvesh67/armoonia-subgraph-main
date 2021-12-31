import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  MarketCreated,
  MarketFeeChanged,
  MarketStateChanged,
  AuctionCreated,
  AuctionSale as AuctionSaleEvent,
  AuctionEnd,
  AuctionBid as AuctionBidEvent,
  CurrencyAdded,
  SellOrderCreated,
  Sale as SaleEvent,
  SellOrderCanceled,
  Withdraw,
  WithdrawNft,
} from "../generated/Marketplace/Marketplace";
import {
  Market,
  Auction,
  Nft,
  AuctionSale,
  AuctionBid,
  MarketCurrencyStats,
  NftCurrencyStats,
  User,
  Currency,
  SellOrder,
  SellOrderSale,
} from "../generated/schema";

let WEI_PER_ETHER = BigInt.fromString("1000000000000000000");

function getUser(address: Address): User {
  let user = User.load(address.toHex());
  if (user == null) {
    user = new User(address.toHex());
    user.address = address;
    user.save();
  }
  return user as User;
}

export function handleCurrencyAdded(event: CurrencyAdded): void {
  let currency = new Currency(event.params.currency.toHex());
  currency.address = event.params.currency;
  currency.save();
}

export function handleMarketCreated(event: MarketCreated): void {
  let market = new Market(event.params.token.toHex());

  market.token = event.params.token;
  market.name = event.params.name;
  market.fee = event.params.fee;
  market.creatorFee = event.params.creatorFee;
  market.reflectionFee = event.params.reflectionFee;
  market.active = true;

  market.totalNfts = 0;
  market.totalAuctions = 0;
  market.totalSellOrders = 0;
  market.totalSales = 0;

  market.save();
}

export function handleMarketFeeChanged(event: MarketFeeChanged): void {
  let market = Market.load(event.params.token.toHex());
  if (market != null) {
    market.fee = event.params.fee;
    market.creatorFee = event.params.creatorFee;
    market.reflectionFee = event.params.reflectionFee;
    market.save();
  }
}

export function handleMarketStateChanged(event: MarketStateChanged): void {
  let market = Market.load(event.params.token.toHex());
  if (market != null) {
    market.active = event.params.isActive;
    market.save();
  }
}

export function handleAuctionCreated(event: AuctionCreated): void {
  let id = event.params.token.toHex() + "-" + event.params.tokenId.toString();

  let market = Market.load(event.params.token.toHex());
  if (market == null) return;

  let user = getUser(event.params.seller);

  let nft = Nft.load(id);

  if (nft == null) {
    nft = new Nft(id);
    nft.token = event.params.token;
    nft.tokenId = event.params.tokenId;
    nft.market = market.id;
    nft.totalSellOrders = 0;
    nft.totalAuctions = 0;
    nft.totalSales = 0;
    nft.save();

    market.totalNfts += 1;
    market.save();
  }

  if (nft != null) {
    let auctionNumber = nft.totalAuctions + 1;

    let auction = new Auction(id + "-" + auctionNumber.toString());

    auction.seller = user.id;
    auction.market = event.params.token.toHex();
    auction.nft = nft.id;
    auction.tokenId = event.params.tokenId;
    auction.currency = event.params.currency.toHex();
    auction.timestamp = event.block.timestamp.toI32();
    auction.ended = false;
    auction.endsAt = event.params.endsAt.toI32();
    auction.initialBid = event.params.initialBid;
    auction.highestBid = event.params.initialBid;
    auction.highestBidder = null;

    auction.save();

    nft.currentAuction = auction.id;
    nft.currentCurrency = auction.currency;
    nft.currentPrice = auction.highestBid;
    nft.totalAuctions += 1;
    nft.save();

    market.totalAuctions += 1;
    market.save();

    let marketCurrencyStatsId = market.id + "-" + auction.currency;
    let marketCurrencyStats = MarketCurrencyStats.load(marketCurrencyStatsId);

    if (marketCurrencyStats == null) {
      marketCurrencyStats = new MarketCurrencyStats(marketCurrencyStatsId);

      marketCurrencyStats.market = market.id;
      marketCurrencyStats.currency = auction.currency;
      marketCurrencyStats.volume = BigInt.fromI32(0);
      marketCurrencyStats.floor = BigInt.fromI32(0);
      marketCurrencyStats.fees = BigInt.fromI32(0);
      marketCurrencyStats.creatorFees = BigInt.fromI32(0);
      marketCurrencyStats.reflectionFees = BigInt.fromI32(0);

      marketCurrencyStats.save();
    }

    let nftCurrencyStatsId = nft.id + "-" + auction.currency;
    let nftCurrencyStats = NftCurrencyStats.load(nftCurrencyStatsId);

    if (nftCurrencyStats == null) {
      nftCurrencyStats = new NftCurrencyStats(nftCurrencyStatsId);

      nftCurrencyStats.nft = nft.id;
      nftCurrencyStats.currency = auction.currency;
      nftCurrencyStats.volume = BigInt.fromI32(0);
      nftCurrencyStats.fees = BigInt.fromI32(0);
      nftCurrencyStats.creatorFees = BigInt.fromI32(0);
      nftCurrencyStats.reflectionFees = BigInt.fromI32(0);

      nftCurrencyStats.save();
    }
  }
}

export function handleAuctionSale(event: AuctionSaleEvent): void {
  let id = event.params.token.toHex() + "-" + event.params.tokenId.toString();

  let nft = Nft.load(id);
  if (nft == null) return;
  let auction = Auction.load(nft.currentAuction);
  if (auction == null) return;

  let market = Market.load(nft.market);
  if (market == null) return;

  let user = getUser(event.params.bidder);

  let saleId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let sale = new AuctionSale(saleId);

  sale.nft = nft.id;
  sale.timestamp = event.block.timestamp.toI32();
  sale.auction = nft.currentAuction;
  sale.seller = auction.seller;
  sale.buyer = user.id;
  sale.currency = auction.currency;
  sale.price = event.params.amount;
  sale.fee = event.params.amount.times(market.fee).div(WEI_PER_ETHER);
  sale.creatorFee = event.params.amount
    .times(market.creatorFee)
    .div(WEI_PER_ETHER);
  sale.reflectionFee = event.params.amount
    .times(market.reflectionFee)
    .div(WEI_PER_ETHER);
  sale.save();

  nft.currentOwner = sale.buyer;
  nft.lastSale = sale.id;
  nft.totalSales += 1;
  nft.save();

  market.totalSales += 1;
  market.save();

  let marketCurrencyStatsId = market.id + "-" + auction.currency;
  let marketCurrencyStats = MarketCurrencyStats.load(marketCurrencyStatsId);

  if (marketCurrencyStats == null) return;

  marketCurrencyStats.fees = marketCurrencyStats.fees.plus(sale.fee);
  marketCurrencyStats.creatorFees = marketCurrencyStats.creatorFees.plus(
    sale.creatorFee
  );
  marketCurrencyStats.reflectionFees = marketCurrencyStats.reflectionFees.plus(
    sale.reflectionFee
  );

  marketCurrencyStats.volume = marketCurrencyStats.volume.plus(sale.price);

  marketCurrencyStats.save();

  let nftCurrencyStatsId = nft.id + "-" + auction.currency;
  let nftCurrencyStats = NftCurrencyStats.load(nftCurrencyStatsId);

  if (nftCurrencyStats == null) return;

  nftCurrencyStats.fees = nftCurrencyStats.fees.plus(sale.fee);
  nftCurrencyStats.creatorFees = nftCurrencyStats.creatorFees.plus(
    sale.creatorFee
  );
  nftCurrencyStats.reflectionFees = nftCurrencyStats.reflectionFees.plus(
    sale.reflectionFee
  );

  nftCurrencyStats.volume = nftCurrencyStats.volume.plus(sale.price);

  nftCurrencyStats.save();
}

export function handleAuctionBid(event: AuctionBidEvent): void {
  let id = event.params.token.toHex() + "-" + event.params.tokenId.toString();

  let nft = Nft.load(id);
  if (nft == null) return;
  let auction = Auction.load(nft.currentAuction);
  if (auction == null) return;
  let user = getUser(event.params.bidder);

  auction.highestBidder = event.params.bidder;
  auction.highestBid = event.params.amount;

  auction.save();

  let bidId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let bid = new AuctionBid(bidId);
  bid.timestamp = event.block.timestamp.toI32();
  bid.auction = auction.id;
  bid.bidder = user.id;
  bid.value = event.params.amount;
  bid.save();

  nft.currentPrice = auction.highestBid;
  nft.save();
}

export function handleAuctionEnd(event: AuctionEnd): void {
  let id = event.params.token.toHex() + "-" + event.params.tokenId.toString();

  let nft = Nft.load(id);
  if (nft == null) return;
  let auction = Auction.load(nft.currentAuction);
  if (auction == null) return;
  auction.ended = true;
  auction.save();

  nft.currentCurrency = null;
  nft.currentAuction = null;
  nft.currentPrice = null;
  nft.save();
}

export function handleSellOrderCreated(event: SellOrderCreated): void {
  let id = event.params.token.toHex() + "-" + event.params.tokenId.toString();

  let market = Market.load(event.params.token.toHex());
  if (market == null) return;

  let user = getUser(event.params.seller);

  let nft = Nft.load(id);

  if (nft == null) {
    nft = new Nft(id);
    nft.token = event.params.token;
    nft.tokenId = event.params.tokenId;
    nft.market = market.id;
    nft.totalSellOrders = 0;
    nft.totalAuctions = 0;
    nft.totalSales = 0;
    nft.save();

    market.totalNfts += 1;
    market.save();
  }

  if (nft != null) {
    let orderNumber = nft.totalSellOrders + 1;

    let order = new SellOrder(id + "-" + orderNumber.toString());

    order.seller = user.id;
    order.market = event.params.token.toHex();
    order.nft = nft.id;
    order.tokenId = event.params.tokenId;
    order.currency = event.params.currency.toHex();
    order.price = event.params.price;
    order.timestamp = event.block.timestamp.toI32();

    order.save();

    nft.currentSellOrder = order.id;
    nft.currentCurrency = order.currency;
    nft.currentPrice = order.price;
    nft.totalSellOrders += 1;
    nft.save();

    market.totalSellOrders += 1;
    market.save();

    let marketCurrencyStatsId = market.id + "-" + order.currency;
    let marketCurrencyStats = MarketCurrencyStats.load(marketCurrencyStatsId);

    if (marketCurrencyStats == null) {
      marketCurrencyStats = new MarketCurrencyStats(marketCurrencyStatsId);

      marketCurrencyStats.market = market.id;
      marketCurrencyStats.currency = order.currency;
      marketCurrencyStats.volume = BigInt.fromI32(0);
      marketCurrencyStats.floor = BigInt.fromI32(0);
      marketCurrencyStats.fees = BigInt.fromI32(0);
      marketCurrencyStats.creatorFees = BigInt.fromI32(0);
      marketCurrencyStats.reflectionFees = BigInt.fromI32(0);

      marketCurrencyStats.save();
    }

    let nftCurrencyStatsId = nft.id + "-" + order.currency;
    let nftCurrencyStats = NftCurrencyStats.load(nftCurrencyStatsId);

    if (nftCurrencyStats == null) {
      nftCurrencyStats = new NftCurrencyStats(nftCurrencyStatsId);

      nftCurrencyStats.nft = nft.id;
      nftCurrencyStats.currency = order.currency;
      nftCurrencyStats.volume = BigInt.fromI32(0);
      nftCurrencyStats.fees = BigInt.fromI32(0);
      nftCurrencyStats.creatorFees = BigInt.fromI32(0);
      nftCurrencyStats.reflectionFees = BigInt.fromI32(0);

      nftCurrencyStats.save();
    }
  }
}

export function handleSellOrderCanceled(event: SellOrderCanceled): void {
  let id = event.params.token.toHex() + "-" + event.params.tokenId.toString();

  let nft = Nft.load(id);
  if (nft == null) return;
  let order = SellOrder.load(nft.currentSellOrder);
  if (order == null) return;
  let market = Market.load(nft.market);
  if (market == null) return;

  nft.currentSellOrder = null;
  nft.currentCurrency = null;
  nft.currentPrice = null;
  nft.save();
}

export function handleSale(event: SaleEvent): void {
  let id = event.params.token.toHex() + "-" + event.params.tokenId.toString();

  let nft = Nft.load(id);
  if (nft == null) return;
  let order = SellOrder.load(nft.currentSellOrder);
  if (order == null) return;
  let market = Market.load(nft.market);
  if (market == null) return;

  let user = getUser(event.params.buyer);

  let saleId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let sale = new SellOrderSale(saleId);

  sale.nft = nft.id;
  sale.timestamp = event.block.timestamp.toI32();
  sale.order = order.id;
  sale.seller = order.seller;
  sale.buyer = user.id;
  sale.currency = order.currency;
  sale.price = event.params.price;
  sale.fee = event.params.price.times(market.fee).div(WEI_PER_ETHER);
  sale.creatorFee = event.params.price
    .times(market.creatorFee)
    .div(WEI_PER_ETHER);
  sale.reflectionFee = event.params.price
    .times(market.reflectionFee)
    .div(WEI_PER_ETHER);
  sale.save();

  nft.currentSellOrder = null;
  nft.currentCurrency = null;
  nft.currentPrice = null;
  nft.lastSale = sale.id;
  nft.totalSales += 1;
  nft.save();

  market.totalSales += 1;
  market.save();

  let marketCurrencyStatsId = market.id + "-" + order.currency;
  let marketCurrencyStats = MarketCurrencyStats.load(marketCurrencyStatsId);

  if (marketCurrencyStats == null) return;

  marketCurrencyStats.fees = marketCurrencyStats.fees.plus(sale.fee);
  marketCurrencyStats.creatorFees = marketCurrencyStats.creatorFees.plus(
    sale.creatorFee
  );
  marketCurrencyStats.reflectionFees = marketCurrencyStats.reflectionFees.plus(
    sale.reflectionFee
  );

  marketCurrencyStats.volume = marketCurrencyStats.volume.plus(sale.price);

  marketCurrencyStats.save();

  let nftCurrencyStatsId = nft.id + "-" + order.currency;
  let nftCurrencyStats = NftCurrencyStats.load(nftCurrencyStatsId);

  if (nftCurrencyStats == null) return;

  nftCurrencyStats.fees = nftCurrencyStats.fees.plus(sale.fee);
  nftCurrencyStats.creatorFees = nftCurrencyStats.creatorFees.plus(
    sale.creatorFee
  );
  nftCurrencyStats.reflectionFees = nftCurrencyStats.reflectionFees.plus(
    sale.reflectionFee
  );

  nftCurrencyStats.volume = nftCurrencyStats.volume.plus(sale.price);

  nftCurrencyStats.save();
}

export function handleWithdrawNft(event: WithdrawNft): void {
  let id = event.params.token.toHex() + "-" + event.params.tokenId.toString();
  let nft = Nft.load(id);
  if (nft == null) return;
  nft.currentOwner = null;
  nft.save();
}
