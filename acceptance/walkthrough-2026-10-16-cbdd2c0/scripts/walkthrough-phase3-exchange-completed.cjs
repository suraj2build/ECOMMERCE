#!/usr/bin/env node
'use strict';
// Acceptance walkthrough, supplementary run: a plain COD order with NO
// discounts, so its later exchange settles EVEN and the full replacement
// dispatch pipeline (pick -> package -> pack -> ready -> book -> handover ->
// deliver) can be demonstrated end to end, with the exchange auto-completing
// on delivery. This proves the EVEN-settlement path only - it does NOT
// verify the CUSTOMER_PAYS path exercised (and left blocked) by
// walkthrough-phase3-exchange-blocked.cjs, which needs a real Razorpay
// sandbox integration. See ../README.md for the full run log and results.
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
const results = JSON.parse(fs.readFileSync('/private/tmp/walkthrough-results-final.json', 'utf8'));
let shotNum = 45;

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

async function main() {
  const browser = await chromium.launch();
  const videoSegments = JSON.parse(fs.readFileSync('/private/tmp/walkthrough-video-segments.json', 'utf8'));
  const mobile2 = `8${String(Date.now()).slice(-9)}`;

  // =================================================================
  // Supplementary: a plain COD order with NO discounts
  // =================================================================
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } } });
  const page = await ctx.newPage();

  await page.goto(`${STOREFRONT}/account`);
  await page.getByLabel('Mobile number').fill(mobile2);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('Enter the 6-digit code')).toBeVisible({ timeout: 10000 });
  const otp = await prisma.otpCode.findFirstOrThrow({ where: { mobile: mobile2, consumedAt: null }, orderBy: { createdAt: 'desc' } });
  await page.getByLabel('Enter the 6-digit code').fill(bruteForceOtp(otp.codeHash));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 10000 });

  await page.goto(`${STOREFRONT}/product/${facts.styleId}`);
  await page.locator('fieldset', { hasText: 'Size' }).getByRole('button', { name: 'Size M', exact: true }).click();
  await page.getByRole('button', { name: 'Add to Bag' }).first().click();
  await expect(page.getByText('Added to bag.').first()).toBeVisible({ timeout: 10000 });

  await page.goto(`${STOREFRONT}/bag`);
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.getByPlaceholder('Full name').fill('Walkthrough Exchange Customer');
  await page.getByPlaceholder('10-digit mobile number').fill(mobile2);
  await page.getByPlaceholder('House / Flat, Building, Street').first().fill('12 Acceptance Avenue');
  await page.getByPlaceholder('PIN code').first().fill('110011');
  await expect(page.getByLabel('City').first()).toHaveValue('New Delhi', { timeout: 10000 });
  await page.getByLabel('Cash on Delivery').check();
  await page.getByRole('button', { name: 'Place Order' }).click();
  await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible({ timeout: 10000 });

  const order2 = await prisma.order.findFirstOrThrow({ where: { contactMobile: mobile2 }, include: { lines: true } });
  facts.order2Id = order2.id;
  facts.order2Number = order2.orderNumber;
  record('Supplementary plain COD order (no discounts) to carry the exchange through to COMPLETED', 'Order placed', `Order ${order2.orderNumber} placed`, 'PASS');
  await ctx.close();
  videoSegments.push(await page.video().path());

  // -- fulfil it fully: pick, package, pack, ready, book, handover, deliver --
  const staffLogin = await (await fetch(`${API}/auth/staff/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }) })).json();

  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 960 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } } });
  const admin = await ctxA.newPage();
  await admin.goto(`${ADMIN}/login`);
  await admin.getByLabel('Email').fill('admin@example.com');
  await admin.getByLabel('Password').fill('ChangeMe123!');
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.waitForURL('**/dashboard', { timeout: 15000 });

  await admin.goto(`${ADMIN}/dashboard/warehouse/picks`);
  await admin.getByRole('row').filter({ hasText: order2.orderNumber }).getByRole('button', { name: 'Record pick' }).click();
  await admin.getByRole('dialog', { name: 'Record pick' }).getByRole('button', { name: 'Record pick' }).click();
  await expect(admin.getByRole('dialog')).toBeHidden({ timeout: 10000 });

  await admin.goto(`${ADMIN}/dashboard/fulfilments`);
  await admin.getByRole('table', { name: 'Picked orders waiting for a package' }).getByRole('row').filter({ hasText: order2.orderNumber }).getByRole('button', { name: 'Create package' }).click();
  await expect(admin.getByText(`Package created for ${order2.orderNumber}. Pack it below.`)).toBeVisible({ timeout: 10000 });

  await admin.goto(`${ADMIN}/dashboard/orders/${order2.id}`);
  await admin.getByRole('button', { name: 'Mark packed', exact: true }).first().click();
  await admin.getByRole('dialog').last().getByRole('button', { name: 'Mark packed' }).last().click();
  await expect(admin.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  await admin.getByRole('button', { name: 'Ready to ship', exact: true }).first().click();
  await confirmDialog(admin, 'Ready to ship');
  await expect(admin.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  await admin.getByRole('button', { name: 'Book shipment with carrier', exact: true }).first().click();
  await confirmDialog(admin, 'Book shipment with carrier');
  await expect(admin.getByRole('dialog')).toBeHidden({ timeout: 10000 });

  await admin.goto(`${ADMIN}/dashboard/fulfilments/handover`);
  await admin.getByLabel(`Handed over: ${order2.orderNumber}`).check();
  await admin.getByLabel(/manifest or pickup reference/).fill(`WALKTHRU-EXC2-${Date.now()}`);
  await admin.getByRole('button', { name: /Confirm handover of 1 parcel/ }).click();
  await expect(admin.getByText('1 parcel recorded as handed over and marked shipped.')).toBeVisible({ timeout: 10000 });

  await admin.goto(`${ADMIN}/dashboard/orders/${order2.id}`);
  await admin.getByRole('button', { name: 'Mark delivered', exact: true }).first().click();
  await confirmDialog(admin, 'Mark delivered');
  await expect(admin.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  record('Fulfil the supplementary order (pick/pack/ready/book/handover/deliver)', 'Order reaches DELIVERED', 'Delivered via the proven pipeline (not re-screenshotted - identical to the main order\'s own run)', 'PASS');
  await ctxA.close();
  videoSegments.push(await admin.video().path());

  // =================================================================
  // Exchange: request -> receive -> QC PASS (EVEN, no coupon this time)
  // -> pick replacement -> package -> pack -> ready -> book -> handover
  // -> deliver -> auto-COMPLETED
  // =================================================================
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } } });
  const cpage = await ctxC.newPage();
  await cpage.goto(`${STOREFRONT}/account`);
  await cpage.getByLabel('Mobile number').fill(mobile2);
  await cpage.getByRole('button', { name: 'Send code' }).click();
  await expect(cpage.getByLabel('Enter the 6-digit code')).toBeVisible({ timeout: 10000 });
  const otp2 = await prisma.otpCode.findFirstOrThrow({ where: { mobile: mobile2, consumedAt: null }, orderBy: { createdAt: 'desc' } });
  await cpage.getByLabel('Enter the 6-digit code').fill(bruteForceOtp(otp2.codeHash));
  await cpage.getByRole('button', { name: 'Verify' }).click();
  await expect(cpage.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 10000 });

  await cpage.goto(`${STOREFRONT}/orders/${order2.id}`);
  await shot(cpage, 'exc2-customer-order-detail-delivered');
  await cpage.getByRole('button', { name: 'Exchange this item' }).click();
  await cpage.getByLabel('Replacement (required)').selectOption(facts.exchangeSkuId);
  await cpage.getByLabel('Reason (required)').fill('Runs slightly large, need a smaller size');
  await cpage.getByLabel('Drop-off').check();
  await shot(cpage, 'exc2-customer-exchange-form-filled');
  await cpage.getByRole('button', { name: 'Start exchange' }).click();
  await expect(cpage.getByText(/Exchange requested/)).toBeVisible({ timeout: 10000 });
  await shot(cpage, 'exc2-customer-exchange-requested');

  const exchange2 = await prisma.exchange.findFirstOrThrow({ where: { orderId: order2.id } });
  facts.exchange2Id = exchange2.id;
  facts.exchange2Number = exchange2.exchangeNumber;
  record(
    'Customer: request a size exchange on the discount-free order (Black M -> Black S)',
    'Exchange requested; EVEN settlement expected (no coupon on this order)',
    `Exchange ${exchange2.exchangeNumber} requested, paymentDirection=${exchange2.paymentDirection}, priceDifference=₹${exchange2.priceDifference}`,
    exchange2.paymentDirection === 'EVEN' ? 'PASS' : 'FAIL',
  );
  await ctxC.close();
  videoSegments.push(await cpage.video().path());

  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 960 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } } });
  const admin2 = await ctxB.newPage();
  await admin2.goto(`${ADMIN}/login`);
  await admin2.getByLabel('Email').fill('admin@example.com');
  await admin2.getByLabel('Password').fill('ChangeMe123!');
  await admin2.getByRole('button', { name: 'Sign in' }).click();
  await admin2.waitForURL('**/dashboard', { timeout: 15000 });

  await admin2.goto(`${ADMIN}/dashboard/exchanges/${exchange2.id}`);
  await shot(admin2, 'exc2-admin-exchange-detail');
  await admin2.getByRole('button', { name: 'Mark received' }).click();
  await confirmDialog(admin2, 'Mark received');
  await expect(admin2.getByText('Mark received: done.')).toBeVisible({ timeout: 10000 });

  await admin2.getByRole('button', { name: 'Record QC' }).click();
  await confirmDialog(admin2, 'Record QC');
  await expect(admin2.getByText('QC recorded.')).toBeVisible({ timeout: 10000 });
  await shot(admin2, 'exc2-admin-qc-passed');

  const exchange2AfterQc = await prisma.exchange.findUniqueOrThrow({ where: { id: exchange2.id } });
  record(
    'Admin: receive + QC-pass -> replacement allocated (EVEN settlement needs no payment step)',
    'status REPLACEMENT_ALLOCATED, replacementAllocatedAt set',
    `status=${exchange2AfterQc.status}; replacementAllocatedAt=${exchange2AfterQc.replacementAllocatedAt}`,
    exchange2AfterQc.status === 'REPLACEMENT_ALLOCATED' && exchange2AfterQc.replacementAllocatedAt ? 'PASS' : 'FAIL',
  );

  await admin2.goto(`${ADMIN}/dashboard/warehouse/picks`);
  await shot(admin2, 'exc2-admin-pick-queue-replacement');
  const replRow = admin2.getByRole('row').filter({ hasText: 'Exchange replacement' });
  await replRow.first().getByRole('button', { name: 'Record pick' }).click();
  await admin2.getByRole('dialog', { name: 'Record pick' }).getByRole('button', { name: 'Record pick' }).click();
  await expect(admin2.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  await shot(admin2, 'exc2-admin-replacement-picked');
  record('Admin: pick the replacement unit (generalized Pick queue)', 'Replacement pick recorded', 'Pick recorded', 'PASS');

  await admin2.goto(`${ADMIN}/dashboard/exchanges/${exchange2.id}`);
  await admin2.getByRole('button', { name: 'Create replacement package' }).click();
  await confirmDialog(admin2, 'Create replacement package');
  await expect(admin2.getByText('Create replacement package: done.')).toBeVisible({ timeout: 10000 });
  await shot(admin2, 'exc2-admin-replacement-package-created');

  const replFulfilment2 = await prisma.orderFulfilment.findFirstOrThrow({ where: { exchangeId: exchange2.id } });
  const dispatchBefore = await prisma.inventoryTransaction.count({ where: { type: 'EXCHANGE_DISPATCH', referenceId: exchange2.id } });

  await admin2.reload();
  await admin2.getByRole('button', { name: 'Mark packed', exact: true }).first().click();
  await admin2.getByRole('dialog').last().getByRole('button', { name: 'Mark packed' }).last().click();
  await expect(admin2.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  await admin2.getByRole('button', { name: 'Ready to ship', exact: true }).first().click();
  await confirmDialog(admin2, 'Ready to ship');
  await expect(admin2.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  await shot(admin2, 'exc2-admin-replacement-ready-to-ship');

  await admin2.getByRole('button', { name: 'Book shipment with carrier', exact: true }).first().click();
  await confirmDialog(admin2, 'Book shipment with carrier');
  await expect(admin2.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  await shot(admin2, 'exc2-admin-replacement-booked');

  const replShipment2 = await prisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: replFulfilment2.id } });
  const dispatchAfterBooking = await prisma.inventoryTransaction.count({ where: { type: 'EXCHANGE_DISPATCH', referenceId: exchange2.id } });
  record(
    'Exchange-replacement booking must move no stock',
    `EXCHANGE_DISPATCH count unchanged at ${dispatchBefore}; shipment BOOKED; handedOverAt null`,
    `EXCHANGE_DISPATCH ${dispatchBefore} -> ${dispatchAfterBooking}; shipment.status=${replShipment2.status}; handedOverAt=${replShipment2.handedOverAt}`,
    dispatchAfterBooking === dispatchBefore && replShipment2.status === 'BOOKED' && replShipment2.handedOverAt === null ? 'PASS' : 'FAIL',
  );

  await admin2.goto(`${ADMIN}/dashboard/fulfilments/handover`);
  await shot(admin2, 'exc2-admin-handover-before');
  const cb = admin2.locator('input[type="checkbox"][aria-label^="Handed over:"]');
  await expect(cb).toHaveCount(1, { timeout: 10000 });
  await cb.check();
  await admin2.getByLabel(/manifest or pickup reference/).fill(`WALKTHRU-EXC2-PICKUP-${Date.now()}`);
  await admin2.getByRole('button', { name: /Confirm handover of 1 parcel/ }).click();
  await expect(admin2.getByText('1 parcel recorded as handed over and marked shipped.')).toBeVisible({ timeout: 10000 });
  await shot(admin2, 'exc2-admin-handover-confirmed');

  const replShipment2AfterHandover = await prisma.shipment.findUniqueOrThrow({ where: { id: replShipment2.id } });
  const dispatchAfterHandover = await prisma.inventoryTransaction.count({ where: { type: 'EXCHANGE_DISPATCH', referenceId: exchange2.id } });
  record(
    'Exchange-replacement handover must post EXCHANGE_DISPATCH exactly once',
    `EXCHANGE_DISPATCH count increases by exactly 1 (from ${dispatchAfterBooking} to ${dispatchAfterBooking + 1})`,
    `EXCHANGE_DISPATCH ${dispatchAfterBooking} -> ${dispatchAfterHandover}; handedOverAt=${replShipment2AfterHandover.handedOverAt}`,
    dispatchAfterHandover === dispatchAfterBooking + 1 && replShipment2AfterHandover.handedOverAt !== null ? 'PASS' : 'FAIL',
  );

  await admin2.goto(`${ADMIN}/dashboard/orders/${order2.id}`);
  await admin2.getByRole('button', { name: 'Mark delivered', exact: true }).first().click();
  await confirmDialog(admin2, 'Mark delivered');
  await expect(admin2.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  await shot(admin2, 'exc2-admin-replacement-delivered');

  const exchange2Final = await prisma.exchange.findUniqueOrThrow({ where: { id: exchange2.id } });
  record(
    'Exchange auto-completes the instant the replacement shipment is DELIVERED',
    'Exchange status COMPLETED, replacementFulfilledAt set',
    `status=${exchange2Final.status}; replacementFulfilledAt=${exchange2Final.replacementFulfilledAt}`,
    exchange2Final.status === 'COMPLETED' ? 'PASS' : 'FAIL',
  );
  await ctxB.close();
  videoSegments.push(await admin2.video().path());

  // Customer sees it completed
  const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } } });
  const cpage2 = await ctxD.newPage();
  await cpage2.goto(`${STOREFRONT}/account`);
  await cpage2.getByLabel('Mobile number').fill(mobile2);
  await cpage2.getByRole('button', { name: 'Send code' }).click();
  await expect(cpage2.getByLabel('Enter the 6-digit code')).toBeVisible({ timeout: 10000 });
  const otp3 = await prisma.otpCode.findFirstOrThrow({ where: { mobile: mobile2, consumedAt: null }, orderBy: { createdAt: 'desc' } });
  await cpage2.getByLabel('Enter the 6-digit code').fill(bruteForceOtp(otp3.codeHash));
  await cpage2.getByRole('button', { name: 'Verify' }).click();
  await expect(cpage2.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 10000 });
  await cpage2.goto(`${STOREFRONT}/orders/${order2.id}`);
  await expect(cpage2.getByText(/Exchange completed/)).toBeVisible({ timeout: 10000 });
  await shot(cpage2, 'exc2-customer-exchange-completed-final');
  record('Customer sees the exchange as completed on their own order page', '"Exchange completed" shown', '"Exchange completed" visible', 'PASS');
  await ctxD.close();
  videoSegments.push(await cpage2.video().path());

  fs.writeFileSync('/private/tmp/walkthrough-facts.json', JSON.stringify(facts, null, 2));
  fs.writeFileSync('/private/tmp/walkthrough-results-final.json', JSON.stringify(results, null, 2));
  fs.writeFileSync('/private/tmp/walkthrough-video-segments.json', JSON.stringify(videoSegments, null, 2));
  await browser.close();
  await prisma.$disconnect();
  console.log('SUPPLEMENTARY EXCHANGE-TO-COMPLETION RUN DONE');
}

main().catch(async (err) => {
  console.error('SUPPLEMENTARY RUN FAILED:', err);
  fs.writeFileSync('/private/tmp/walkthrough-results-final.json', JSON.stringify(results, null, 2));
  fs.writeFileSync('/private/tmp/walkthrough-facts.json', JSON.stringify(facts, null, 2));
  await prisma.$disconnect();
  process.exit(1);
});
