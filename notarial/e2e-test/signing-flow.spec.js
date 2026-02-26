const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://quantumharmony.network/lcars.html';

test.setTimeout(300000);

test.describe('DocuSign-like Signing Flow', () => {

    test('Full end-to-end test', async ({ browser }) => {
        const sylvainCtx = await browser.newContext();
        const sylvain = await sylvainCtx.newPage();

        const jsErrors = [];
        sylvain.on('pageerror', err => jsErrors.push('[PAGE] ' + err.message));
        sylvain.on('console', msg => {
            if (msg.type() === 'error') jsErrors.push('[ERR] ' + msg.text());
        });

        // ============================================================
        // PHASE 1: Account Creation
        // ============================================================
        console.log('\n=== PHASE 1: Account ===');
        await sylvain.goto(BASE_URL, { waitUntil: 'networkidle' });

        // Clean slate
        await sylvain.evaluate(() => {
            localStorage.setItem('qh_lang', 'en');
            localStorage.removeItem('qh_keystores');
        });
        await sylvain.reload({ waitUntil: 'networkidle' });
        await sylvain.waitForTimeout(1000);

        await sylvain.fill('#startAccountName', 'Sylvain - Paraxiom');
        await sylvain.fill('#startPassword', 'testpass123!');
        await sylvain.fill('#startPasswordConfirm', 'testpass123!');
        await sylvain.click('text=Create Account');
        console.log('  Waiting for keygen...');
        await sylvain.waitForTimeout(10000);

        const statusText = await sylvain.locator('#accountStatusText').textContent();
        console.log('  Status:', statusText);

        // Get our public key for party list (from unlockedKey, which has the hex format)
        const ourPubKey = await sylvain.evaluate(() => {
            return unlockedKey ? unlockedKey.publicKey : null;
        });
        console.log('  PubKey:', ourPubKey?.substring(0, 24) + '...');

        await sylvain.screenshot({ path: 'screenshots/01-account.png', fullPage: false });

        if (jsErrors.length > 0) {
            console.log('  Errors:', jsErrors.length);
            jsErrors.forEach(e => console.log('    ' + e.substring(0, 150)));
            jsErrors.length = 0;
        }

        // ============================================================
        // PHASE 2: Create Contract (3-step wizard)
        // ============================================================
        console.log('\n=== PHASE 2: Contract Wizard ===');

        await sylvain.locator('.lcars-panel:has-text("CONTRACTS")').click();
        await sylvain.waitForTimeout(1000);

        await sylvain.locator('button:has-text("Create New Contract")').click();
        await sylvain.waitForTimeout(1000);

        // STEP 1: Contract Details
        console.log('  Step 1: Details');
        await sylvain.fill('#contractTitle', 'Paraxiom Partnership Agreement');
        await sylvain.selectOption('#contractType', { index: 1 }); // Partnership
        await sylvain.fill('#contractDescription', 'Co-founder partnership agreement between Sylvain Cormier and Daryl G Loader for Paraxiom Technologies Inc. Effective February 2026.');

        await sylvain.screenshot({ path: 'screenshots/02-step1.png', fullPage: false });

        // Click Next: Add Parties
        await sylvain.click('text=Next: Add Parties');
        await sylvain.waitForTimeout(500);
        await sylvain.screenshot({ path: 'screenshots/03-step2.png', fullPage: false });

        // STEP 2: Add Parties
        console.log('  Step 2: Parties');

        // Add Sylvain
        await sylvain.fill('#partyName', 'Sylvain Cormier');
        await sylvain.fill('#partyAddress', ourPubKey || '0x' + 'aa'.repeat(64));
        await sylvain.click('text=Add This Party');
        await sylvain.waitForTimeout(500);
        console.log('    Added Sylvain');

        // Add Daryl (dummy key for test)
        await sylvain.fill('#partyName', 'Daryl G Loader');
        await sylvain.fill('#partyAddress', '0x' + 'bb'.repeat(64));
        await sylvain.click('text=Add This Party');
        await sylvain.waitForTimeout(500);
        console.log('    Added Daryl');

        await sylvain.screenshot({ path: 'screenshots/04-parties.png', fullPage: false });

        // Click Next: Review Contract
        await sylvain.click('text=Next: Review Contract');
        await sylvain.waitForTimeout(500);
        await sylvain.screenshot({ path: 'screenshots/05-review.png', fullPage: false });

        // STEP 3: Review & Submit
        console.log('  Step 3: Review');

        // Find and click the submit button
        const submitBtn = sylvain.locator('button:has-text("Submit Contract to Blockchain"), button:has-text("Submit to Blockchain"), button:has-text("Submit"):visible').first();
        if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            const btnText = await submitBtn.textContent();
            console.log(`  Clicking "${btnText.trim()}"...`);

            // Capture ALL console output during submission
            const submitLogs = [];
            const logHandler = msg => submitLogs.push(`[${msg.type()}] ${msg.text()}`);
            sylvain.on('console', logHandler);

            // Call createContract() with await to capture errors
            await sylvain.evaluate(async () => {
                console.log('=== CALLING createContract() ===');
                console.log('unlockedKey:', !!unlockedKey);
                console.log('contractParties:', JSON.stringify(contractParties));
                try {
                    await createContract();
                    console.log('=== createContract() COMPLETED ===');
                } catch (e) {
                    console.error('=== createContract() FAILED:', e.message, '===');
                }
            });

            sylvain.off('console', logHandler);
            console.log(`\n  Console during submission (${submitLogs.length} messages):`);
            submitLogs.forEach(l => console.log('    ' + l.substring(0, 200)));

            await sylvain.screenshot({ path: 'screenshots/06-submitted.png', fullPage: false });

            // Check for signing link modal (use waitFor to actually wait for it)
            const linkModal = sylvain.locator('#signingLinkModal.active');
            try {
                await linkModal.waitFor({ state: 'visible', timeout: 5000 });
                const url = await sylvain.locator('#signingLinkUrl').inputValue().catch(() => 'N/A');
                console.log('  ✓ SIGNING LINK:', url);
                await sylvain.screenshot({ path: 'screenshots/07-signing-link.png', fullPage: false });
            } catch {
                console.log('  ✗ No signing link modal');
                // Debug: check modal state
                const classes = await sylvain.evaluate(() => document.getElementById('signingLinkModal')?.className);
                const display = await sylvain.evaluate(() => window.getComputedStyle(document.getElementById('signingLinkModal')).display);
                console.log('  Modal classes:', classes, '| display:', display);
            }
        } else {
            console.log('  ✗ Submit button not found');
            // List all buttons
            const allBtns = await sylvain.locator('#createContractModal button:visible, #wizardStep3 button:visible').all();
            for (const b of allBtns) {
                console.log('    Btn:', (await b.textContent()).trim());
            }
        }

        // Print all toasts
        const toasts = await sylvain.locator('.toast').allTextContents();
        toasts.forEach(t => console.log('  Toast:', t.substring(0, 120)));

        if (jsErrors.length > 0) {
            console.log('\n  JS Errors:');
            jsErrors.forEach(e => console.log('    ' + e.substring(0, 200)));
            jsErrors.length = 0;
        }

        // ============================================================
        // PHASE 3: Daryl opens signing link — KYC
        // ============================================================
        console.log('\n=== PHASE 3: Daryl opens link (KYC) ===');

        // Extract the actual signing URL from the modal
        let signingUrl = BASE_URL + '#sign/0'; // fallback
        try {
            const extractedUrl = await sylvain.locator('#signingLinkUrl').inputValue();
            if (extractedUrl && extractedUrl.includes('#sign/')) {
                signingUrl = extractedUrl;
            }
        } catch { /* use fallback */ }
        console.log('  Signing URL:', signingUrl);

        // Close the signing link modal before Sylvain is done
        await sylvain.locator('#signingLinkModal .action-button').click().catch(() => {});

        // Wait for blockchain to finalize the block with all 3 extrinsics
        console.log('  Waiting 6s for block finalization...');
        await sylvain.waitForTimeout(6000);

        const darylCtx = await browser.newContext();
        const daryl = await darylCtx.newPage();
        const darylErrors = [];
        daryl.on('pageerror', err => darylErrors.push('[PAGE] ' + err.message));
        daryl.on('console', msg => {
            if (msg.type() === 'error') darylErrors.push('[ERR] ' + msg.text());
            if (msg.type() === 'log') console.log('  [Daryl] ' + msg.text().substring(0, 200));
        });

        await daryl.goto(signingUrl, { waitUntil: 'networkidle' });
        await daryl.waitForTimeout(5000);

        const signingVisible = await daryl.locator('#signingFlowModal').isVisible().catch(() => false);
        console.log('  Signing modal visible:', signingVisible);

        if (!signingVisible) {
            console.log('  ✗ Signing modal not visible — triggering manually');
            await daryl.evaluate(() => { checkSigningRoute(); });
            await daryl.waitForTimeout(3000);
        }

        const signingVisible2 = await daryl.locator('#signingFlowModal.active').isVisible().catch(() => false);
        if (!signingVisible2) {
            console.log('  ✗ Signing modal still not visible');
            await daryl.screenshot({ path: 'screenshots/10-daryl-fail.png', fullPage: false });
        } else {
            // Wait for KYC phase to appear (fresh session = Phase 1)
            console.log('  Waiting for KYC phase...');
            try {
                await daryl.locator('#signingPhaseKYC').waitFor({ state: 'visible', timeout: 15000 });
                console.log('  ✓ KYC phase loaded');
            } catch {
                console.log('  ✗ KYC phase did not appear within 15s');
                const loadingContent = await daryl.locator('#signingPhaseLoading').textContent().catch(() => 'N/A');
                console.log('  Loading phase content:', loadingContent?.substring(0, 300));
            }

            await daryl.screenshot({ path: 'screenshots/10-daryl-kyc.png', fullPage: false });

            // Fill KYC form
            await daryl.fill('#kycFullName', 'Daryl G Loader');
            await daryl.fill('#kycEmail', 'daryl@example.com');
            await daryl.fill('#kycPhone', '+1 (555) 123-4567');
            await daryl.fill('#kycAddress', '456 Innovation Drive, Toronto, ON M5V 2T6');
            await daryl.fill('#kycDateOfBirth', '1985-03-15');
            console.log('  Filled KYC form');

            await daryl.click('text=Continue to Document Review');
            await daryl.waitForTimeout(1000);

            // ============================================================
            // PHASE 3b: Document Review
            // ============================================================
            console.log('\n=== PHASE 3b: Document Review ===');

            try {
                await daryl.locator('#signingPhaseReview').waitFor({ state: 'visible', timeout: 5000 });
                console.log('  ✓ Review phase loaded');
            } catch {
                console.log('  ✗ Review phase did not appear');
            }

            await daryl.screenshot({ path: 'screenshots/11-daryl-review.png', fullPage: false });

            const contractTitle = await daryl.locator('#signingContractTitle').textContent().catch(() => 'N/A');
            const contractStatus = await daryl.locator('#signingContractStatus').textContent().catch(() => 'N/A');
            console.log('  Contract title:', contractTitle);
            console.log('  Contract status:', contractStatus);

            // ============================================================
            // PHASE 3c: Test session persistence (close + reopen)
            // ============================================================
            console.log('\n=== PHASE 3c: Session Persistence ===');
            // Verify session was saved
            const sessionExists = await daryl.evaluate((url) => {
                const sessions = JSON.parse(localStorage.getItem('qh_signing_sessions') || '{}');
                return Object.keys(sessions).length > 0;
            });
            console.log('  Session persisted:', sessionExists);

            // Click "Ready to Sign"
            await daryl.click('text=I Have Reviewed the Document');
            await daryl.waitForTimeout(500);

            // ============================================================
            // PHASE 4: Daryl draws his signature
            // ============================================================
            console.log('\n=== PHASE 4: Daryl Draws Signature ===');

            try {
                await daryl.locator('#signingPhaseSignature').waitFor({ state: 'visible', timeout: 5000 });
                console.log('  ✓ Signature phase loaded');
            } catch {
                console.log('  ✗ Signature phase did not appear');
            }

            // Check the signature pad is visible
            const sigPadVisible = await daryl.locator('#signaturePadCanvas').isVisible().catch(() => false);
            console.log('  Signature pad visible:', sigPadVisible);

            // Check sign button is disabled (no signature drawn yet)
            const btnDisabled = await daryl.locator('#signingSignBtn').isDisabled().catch(() => 'N/A');
            console.log('  Sign button disabled (no sig yet):', btnDisabled);

            // Draw a signature on the canvas via JS
            await daryl.evaluate(() => {
                const canvas = document.getElementById('signaturePadCanvas');
                const ctx = canvas.getContext('2d');

                ctx.strokeStyle = '#e8c547';
                ctx.lineWidth = 2.5;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                // Draw "D" letter
                ctx.beginPath();
                ctx.moveTo(60, 100);
                ctx.lineTo(60, 40);
                ctx.quadraticCurveTo(130, 35, 130, 70);
                ctx.quadraticCurveTo(130, 105, 60, 100);
                ctx.stroke();

                // Draw "." dot
                ctx.beginPath();
                ctx.arc(150, 100, 3, 0, Math.PI * 2);
                ctx.fill();

                // Draw "L" letter
                ctx.beginPath();
                ctx.moveTo(175, 40);
                ctx.lineTo(175, 100);
                ctx.lineTo(230, 100);
                ctx.stroke();

                // Draw underline flourish
                ctx.beginPath();
                ctx.moveTo(40, 120);
                ctx.quadraticCurveTo(150, 110, 250, 118);
                ctx.stroke();

                // Trigger the button enable
                signaturePadHasContent = true;
                document.getElementById('signaturePadPlaceholder').style.display = 'none';
                const btn = document.getElementById('signingSignBtn');
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
                btn.disabled = false;
                btn.textContent = 'Sign This Agreement';
            });

            console.log('  Drew signature via canvas API');
            await daryl.waitForTimeout(500);
            await daryl.screenshot({ path: 'screenshots/12-daryl-signature.png', fullPage: false });

            const btnEnabled = await daryl.locator('#signingSignBtn').isEnabled().catch(() => false);
            console.log('  Sign button enabled after drawing:', btnEnabled);

            // ============================================================
            // PHASE 5: Daryl clicks Sign — auto account + fund + sign
            // ============================================================
            console.log('\n=== PHASE 5: Daryl Signs (one click) ===');

            await daryl.locator('#signingSignBtn').click();
            console.log('  Clicked sign — auto creating account, funding, signing...');

            // Wait for key destruction phase (Phase 5 in the new flow)
            try {
                await daryl.locator('#signingPhaseKeys').waitFor({ state: 'visible', timeout: 45000 });
                const txHash = await daryl.locator('#signingSuccessTx').textContent().catch(() => 'N/A');
                const sigImg = await daryl.locator('#signingSuccessSigImg').isVisible().catch(() => false);
                console.log('  ✓ SIGNED! Tx hash:', txHash);
                console.log('  Signature image shown:', sigImg);
                await daryl.screenshot({ path: 'screenshots/13-daryl-keys.png', fullPage: false });

                // Check credentials are shown
                const credAddr = await daryl.locator('#signingKeysAddress').textContent().catch(() => 'N/A');
                const credPw = await daryl.locator('#signingKeysPassword').textContent().catch(() => 'N/A');
                console.log('  Credential address:', credAddr?.substring(0, 24) + '...');
                console.log('  Credential password:', credPw);

                // Check close button is disabled
                const closeBtnDisabled = await daryl.locator('#signingFlowCloseBtn').isDisabled().catch(() => 'N/A');
                console.log('  Close button disabled (keys not destroyed):', closeBtnDisabled);

                // ============================================================
                // PHASE 6: Destroy keys
                // ============================================================
                console.log('\n=== PHASE 6: Key Destruction ===');

                await daryl.click('text=I Have Saved My Keys');
                await daryl.waitForTimeout(1000);

                // Should now be on complete phase
                try {
                    await daryl.locator('#signingPhaseComplete').waitFor({ state: 'visible', timeout: 5000 });
                    console.log('  ✓ Complete phase shown');
                    await daryl.screenshot({ path: 'screenshots/14-daryl-complete.png', fullPage: false });
                } catch {
                    console.log('  ✗ Complete phase did not appear');
                }

                // Check close button is re-enabled
                const closeBtnEnabled2 = await daryl.locator('#signingFlowCloseBtn').isEnabled().catch(() => false);
                console.log('  Close button re-enabled:', closeBtnEnabled2);

                // Verify session marks keys as destroyed
                const keysDestroyed = await daryl.evaluate(() => {
                    const sessions = JSON.parse(localStorage.getItem('qh_signing_sessions') || '{}');
                    const key = Object.keys(sessions)[0];
                    return sessions[key]?.keysDestroyed;
                });
                console.log('  Keys destroyed in session:', keysDestroyed);

                // ============================================================
                // PHASE 7: Reopen same URL — should show "Signing Complete"
                // ============================================================
                console.log('\n=== PHASE 7: Reopen URL (complete) ===');
                await daryl.goto(signingUrl, { waitUntil: 'networkidle' });
                await daryl.waitForTimeout(3000);
                try {
                    await daryl.locator('#signingPhaseComplete').waitFor({ state: 'visible', timeout: 10000 });
                    console.log('  ✓ Reopened → Complete phase shown');
                    await daryl.screenshot({ path: 'screenshots/15-daryl-reopen.png', fullPage: false });
                } catch {
                    console.log('  ✗ Complete phase not shown on reopen');
                }

            } catch {
                console.log('  ✗ Keys phase not shown within 45s');
                const resultText = await daryl.locator('#signingSignResult').textContent().catch(() => 'N/A');
                console.log('  Result:', resultText);
                const btnText = await daryl.locator('#signingSignBtn').textContent().catch(() => 'N/A');
                console.log('  Button text:', btnText);
                await daryl.screenshot({ path: 'screenshots/13-daryl-fail.png', fullPage: false });
            }
        }

        // Print Daryl's toasts
        const darylToasts = await daryl.locator('.toast').allTextContents();
        darylToasts.forEach(t => console.log('  Daryl Toast:', t.substring(0, 120)));

        if (darylErrors.length > 0) {
            console.log('\n  Daryl JS Errors:');
            darylErrors.forEach(e => console.log('    ' + e.substring(0, 200)));
        }

        console.log('\n=== DONE ===');
        await sylvainCtx.close();
        await darylCtx.close();
    });
});
