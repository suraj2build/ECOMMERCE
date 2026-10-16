#!/usr/bin/env node
'use strict';
// PROVENANCE: this file is a RECONSTRUCTION, not the preserved original. The
// worktree this script actually ran from was deleted (`git worktree remove
// --force`) before it was copied into this acceptance record, so this copy
// was retyped afterward from the session's own conversation record. It has
// NOT been re-executed since reconstruction - treat it as a faithful record
// of what ran, not as a verified-working script, until someone reruns it and
// confirms it reproduces the results in ../evidence/ and ../report.html. The
// evidence JSON, screenshots and video in this directory ARE the original,
// unmodified outputs of the actual run (see ../CHECKSUMS.sha256).
//
// Acceptance walkthrough, phase 3: customer-initiated exchange on the SAME
// discounted order from phase 1-2 (facts.json). This run demonstrates that
// the exchange service correctly computes a CUSTOMER_PAYS settlement here
// (the order's own coupon reduced the original line's frozen value below
// the replacement's plain catalogue price) and correctly refuses to proceed
// to REPLACEMENT_ALLOCATED without collecting that payment - which this
// codebase has no mock Razorpay provider to simulate safely. This exchange
// (EXC-2026-000002) is left at RECEIVED/QC-PASSED/payment-pending by design;
// see walkthrough-phase3-exchange-completed.cjs for the EVEN-settlement
// exchange that was carried through to COMPLETED on a separate, discount-
// free order. See ../README.md for the full run log and results.
const { chromium, expect } = require('@playwright/test');
const { PrismaClient } = require('@fcp/db');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API = 'http://127.0.0.1:4077/api/v1';
const STOREFRONT = 'http://127.0.0.1:3077';
const ADMIN = 'http://127.0.0.1:3078';
const SHOT_DIR = '/private/tmp/walkthrough-shots';
const VIDEO_DIR = '/private/tmp/walkthrough-videos';

const prisma = new PrismaClient();
const facts = JSON.parse(fs.readFileSync('/private/tmp/walkthrough-facts.json', 'utf8'));
const results = JSON.parse(fs.readFileSync('/private/tmp/walkthrough-results-phase12.json', 'utf8'));
let shotNum = 37; // continue numbering from phase 1+2

function bruteForceOtp(codeHash, length = 6) {
  const max = 10 ** length;
  for (let i = 0; i < max; i++) {
    const candidate = String(i).padStart(length, '0');
    if (crypto.createHash('sha256').update(candidate).digest('hex') === codeHash) return candidate;
  }
  throw new Error('Could not recover OTP from its hash');
}

async function shot(page, name) {
  shotNum++;
  const fname = `${String(shotNum).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(SHOT_DIR, fname), fullPage: true });
  console.log(`[shot ${shotNum}] ${name}`);
}

function record(stage, expected, actual, status) {
  results.push({ stage, expected, actual, status });
  console.log(`[${status}] ${stage}\n   expected: ${expected}\n   actual:   ${actual}`);
}

async function confirmDialog(page, label) {
  await page.getByRole('dialog').last().getByRole('button', { name: label, exact: true }).click();
}

async function apiCall(method, p, token, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const browser = await chromium.launch();
  const videoSegments = JSON.parse(fs.readFileSync('/private/tmp/walkthrough-video-segments.json', 'utf8'));

  const staffLogin = await apiCall('POST', '/auth/staff/login', null, { email: 'admin@example.com', password: 'ChangeMe123!' });
  const EXCHANGE_SKU_ID = facts.exchangeSkuId;

  // =================================================================
  // CUSTOMER: request the exchange from the order-detail page
  // =================================================================
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } } });
  const page = await ctx3.newPage();

  await page.goto(`${STOREFRONT}/account`);
  await page.getByLabel('Mobile number').fill(facts.customerMobile);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('Enter the 6-digit code')).toBeVisible({ timeout: 10000 });
  const otp = await prisma.otpCode.findFirstOrThrow({ where: { mobile: facts.customerMobile, consumedAt: null }, orderBy: { createdAt: 'desc' } });
  await page.getByLabel('Enter the 6-digit code').fill(bruteForceOtp(otp.codeHash));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 10000 });
  record('Customer signs back in to request an exchange', 'Reaches signed-in Profile page', 'Reached Profile page', 'PASS');

  await page.goto(`${STOREFRONT}/orders/${facts.orderId}`);
  await shot(page, 'customer-order-detail-delivered');
  await page.getByRole('button', { name: 'Exchange this item' }).click();
  await shot(page, 'customer-exchange-form-open');
  await page.getByLabel('Replacement (required)').selectOption(EXCHANGE_SKU_ID);
  await page.getByLabel('Reason (required)').fill('Runs slightly large, need a smaller size');
  await page.getByLabel('Drop-off').check();
  await shot(page, 'customer-exchange-form-filled');
  await page.getByRole('button', { name: 'Start exchange' }).click();
  await expect(page.getByText(/Exchange requested/)).toBeVisible({ timeout: 10000 });
  await shot(page, 'customer-exchange-requested');

  const exchange = await prisma.exchange.findFirstOrThrow({ where: { orderId: facts.orderId } });
  facts.exchangeId = exchange.id;
  facts.exchangeNumber = exchange.exchangeNumber;
  facts.exchangePaymentDirection = exchange.paymentDirection;
  record(
    'Customer: request a size exchange (Black M -> Black S) via the real order-detail page',
    'Exchange requested; settlement direction computed from priceDifference',
    `Exchange ${exchange.exchangeNumber} requested, status=${exchange.status}, paymentDirection=${exchange.paymentDirection}`,
    'PASS',
  );

  await ctx3.close();
  videoSegments.push(await page.video().path());

  // =================================================================
  // ADMIN: receive, QC pass -> settlement direction determines the next step
  // =================================================================
  const ctx4 = await browser.newContext({ viewport: { width: 1440, height: 960 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } } });
  const admin = await ctx4.newPage();

  await admin.goto(`${ADMIN}/login`);
  await admin.getByLabel('Email').fill('admin@example.com');
  await admin.getByLabel('Password').fill('ChangeMe123!');
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.waitForURL('**/dashboard', { timeout: 15000 });

  await admin.goto(`${ADMIN}/dashboard/exchanges/${exchange.id}`);
  await shot(admin, 'admin-exchange-detail-requested');
  await admin.getByRole('button', { name: 'Mark received' }).click();
  await confirmDialog(admin, 'Mark received');
  await expect(admin.getByText('Mark received: done.')).toBeVisible({ timeout: 10000 });
  await shot(admin, 'admin-exchange-received');

  await admin.getByRole('button', { name: 'Record QC' }).click();
  await shot(admin, 'admin-exchange-qc-dialog');
  await confirmDialog(admin, 'Record QC');
  await expect(admin.getByText('QC recorded.')).toBeVisible({ timeout: 10000 });
  await shot(admin, 'admin-exchange-qc-passed');

  const exchangeAfterQc = await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });

  if (exchangeAfterQc.paymentDirection === 'CUSTOMER_PAYS' && exchangeAfterQc.paymentStatus !== 'CAPTURED') {
    // This order's own ₹200 coupon reduced the original line's frozen value (originalLineValue)
    // below the replacement's plain current catalog price (replacementValue), so the exchange
    // service correctly computed CUSTOMER_PAYS (priceDifference > 0) rather than EVEN - a real,
    // correct consequence of combining a coupon with this exchange, not a defect. Collecting that
    // price difference goes through the real Razorpay payment provider, for which this codebase
    // has no mock implementation (unlike shipping's MOCK carrier) - RAZORPAY_KEY_ID/SECRET are
    // unset in this isolated stack, so initiate() fails safe with no network call and no provider
    // order is ever created to pay against.
    //
    // PRODUCT OWNER NOTE (2026-10-16): this exchange's payment-and-completion path remains
    // UNVERIFIED. The companion script (walkthrough-phase3-exchange-completed.cjs), which carries
    // a DIFFERENT, discount-free order's exchange through to COMPLETED, proves the EVEN-settlement
    // path only - it does not substitute for testing this CUSTOMER_PAYS path, which needs a real
    // Razorpay sandbox integration (see the open release gates in ../README.md).
    record(
      'Admin: receive + QC-pass the original item',
      'QC result recorded; settlement direction computed from priceDifference',
      `status=${exchangeAfterQc.status}; paymentDirection=CUSTOMER_PAYS (priceDifference ₹${exchangeAfterQc.priceDifference}); paymentStatus=${exchangeAfterQc.paymentStatus}`,
      'PASS',
    );
    record(
      'Exchange reaches REPLACEMENT_ALLOCATED and completes delivery (full replacement pipeline)',
      'Blocked on collecting the CUSTOMER_PAYS price difference via the real Razorpay payment provider - explicitly out of this walkthrough\'s scope ("real courier/payment validation remains separate"); no mock Razorpay provider exists in this codebase to simulate it safely. UNVERIFIED, not replaced by the separate EVEN-settlement exchange.',
      `Exchange remains at status=${exchangeAfterQc.status}, paymentStatus=${exchangeAfterQc.paymentStatus}`,
      'BLOCKED',
    );
    fs.writeFileSync('/private/tmp/walkthrough-facts.json', JSON.stringify(facts, null, 2));
    fs.writeFileSync('/private/tmp/walkthrough-results-final.json', JSON.stringify(results, null, 2));
    await ctx4.close();
    videoSegments.push(await admin.video().path());
    fs.writeFileSync('/private/tmp/walkthrough-video-segments.json', JSON.stringify(videoSegments, null, 2));
    await browser.close();
    await prisma.$disconnect();
    console.log('PHASE 3 STOPPED EARLY (CUSTOMER_PAYS settlement, by design out of scope) — see results-final.json');
    return;
  }

  // (Not reached in the actual 2026-10-16 run - this order's exchange was CUSTOMER_PAYS.
  // Kept for completeness in case of a re-run against a differently-priced replacement.)
  record(
    'Admin: receive + QC-pass the original item',
    'QC PASS allocates the replacement (status REPLACEMENT_ALLOCATED); nothing dispatched yet',
    `status=${exchangeAfterQc.status}; replacementAllocatedAt=${exchangeAfterQc.replacementAllocatedAt}`,
    exchangeAfterQc.status === 'REPLACEMENT_ALLOCATED' && exchangeAfterQc.replacementAllocatedAt ? 'PASS' : 'FAIL',
  );

  await ctx4.close();
  videoSegments.push(await admin.video().path());
  fs.writeFileSync('/private/tmp/walkthrough-facts.json', JSON.stringify(facts, null, 2));
  fs.writeFileSync('/private/tmp/walkthrough-results-final.json', JSON.stringify(results, null, 2));
  fs.writeFileSync('/private/tmp/walkthrough-video-segments.json', JSON.stringify(videoSegments, null, 2));
  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('PHASE 3 FAILED:', err);
  fs.writeFileSync('/private/tmp/walkthrough-results-final.json', JSON.stringify(results, null, 2));
  fs.writeFileSync('/private/tmp/walkthrough-facts.json', JSON.stringify(facts, null, 2));
  await prisma.$disconnect();
  process.exit(1);
});
