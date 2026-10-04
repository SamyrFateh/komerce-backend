# CJ Purchasing Contract — characterization before P1

> Status: contract characterized from current official CJ API documentation. No live order mutation has been executed by this document or module.

## Goal

CJ is already a sourcing provider in Komerce. This document characterizes its buyer-side purchasing conversation before any `placeOrder()` capability is opened.

The purpose is to separate:
- documented provider capability;
- Komerce payload mapping;
- account/business readiness;
- live P1 create/read-back proof;
- payment/commitment proof.

## Official provider surface observed

Current CJ API 2.0 documentation exposes at least:

    POST  /api2.0/v1/shopping/order/createOrderV2
    GET   /api2.0/v1/shopping/order/getOrderDetail
    PATCH /api2.0/v1/shopping/order/confirmOrder
    POST  /api2.0/v1/shopping/pay/payBalanceV2
    POST  /api2.0/v1/logistic/freightCalculate

The provider therefore documents a buyer-side order creation surface.

This does NOT yet mean Komerce may enable auto_order.

## Conversation

### EXPECTS

Komerce needs:
- exact CJ Supplier Order Identity;
- pid / vid / variant_sku;
- quantity;
- destination;
- selected logistics name;
- origin country;
- stable Komerce orderNumber.

### REQUIRES

Provider documentation requires for createOrderV2:
- CJ access token;
- shipping destination fields;
- logisticName;
- fromCountryCode;
- product VID + quantity.

Komerce still has to prove with its own account:
- endpoint permission;
- acceptable countries/origins;
- usable logistics options;
- sandbox/live mode behavior;
- payment policy;
- idempotence semantics around orderNumber.

### SENDS

Komerce will use `payType=3` for the first bounded P1 proof.

Reason:
- create order only;
- no balance deduction;
- no payment;
- no automatic confirmation side effect.

No P1 proof should begin with payType=2.

### RECEIVES

createOrderV2 can return:
- orderId;
- orderNumber;
- shipmentOrderId;
- product/postage amounts;
- requestId.

### CONFIRMS

The first P1 proof must read the created order back with getOrderDetail and verify:
- same Komerce orderNumber;
- same exact VID;
- same quantity;
- expected destination/logistics context;
- status consistent with an unpaid/uncommitted test order.

A create response alone is not sufficient.

### EXPOSES

Before payment/confirmation, Komerce may expose only:

    provider = cj
    external_ref = CJ orderId
    commitment_verdict = created_unpaid

It must NOT expose `committed`.

## Identity mapping

Existing CJ source V2 already persists:

    supplier_order_identity = {
      provider: "cj",
      version: 1,
      payload: {
        pid,
        vid,
        variant_sku
      }
    }

The purchasing contract reuses that exact identity. It does not re-resolve a generic product SKU.

## First execution strategy

The first safe mutation campaign is intentionally split:

### CJ-P1a — create-only

    exact SKU/SOI
    → readiness
    → build createOrderV2 payload
    → payType=3
    → create
    → getOrderDetail read-back
    → verify exact VID/qty/orderNumber
    → stop

No balance payment.

### CJ-P1b — cleanup / repeatability

If CJ supports deleting the created unpaid order in the observed state, prove cleanup separately.

### CJ-P1c — idempotence

The provider docs observed here do not by themselves prove that replaying the same `orderNumber` is idempotent.

Therefore a lost-response retry strategy remains UNKNOWN and auto_order stays CLOSED until a bounded provider proof establishes one of:
- native idempotency;
- deterministic duplicate rejection;
- exact read-before-retry strategy.

### CJ-P1d — payment/commitment

Only after P1a/P1c:
- confirm order if required by the selected CJ flow;
- payBalanceV2 or another explicitly approved payment path;
- read back the resulting state;
- reconcile provider commitment.

This is a separate proof from order creation.

## Current capability state

    sourcing.catalog_stock      proven historically, reconciliation ongoing
    purchasing.contract         DOCUMENTED
    purchasing.readiness        not yet implemented for CJ
    purchasing.build_payload    characterized by cj-purchasing-contract.js
    purchasing.place_order      CLOSED
    purchasing.reconcile        CLOSED
    purchasing.payment          CLOSED

## Non-negotiable rule

The existence of createOrderV2 in CJ documentation is not enough to register `placeOrder()`.

Registration requires:

    P0 account/business readiness PASS
    + P1 create/read-back PASS
    + retry/idempotence strategy PASS
    + P2 adapter mapping PASS
    + P3 pipeline PASS

Until then CJ remains non-auto-ordering in execution-adapter-registry.
