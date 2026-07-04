import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// The count steppers (−/+) on match hit-entry, exercised in the real USPSA flow:
// tapping "+" increments the field (proving the button feeds React state, since the
// input value is controlled), "−" floors at 0, and the "−" button disables at 0.
// The number stays typeable — that path is already covered by idpa-scoring.spec.

test.describe('count stepper', () => {
  test('increments and decrements a hit-breakdown count, and disables − at zero', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this Match is called').fill('Stepper Test');
    await page.getByRole('button', { name: '+ Add Stage' }).click();

    const block = page.locator('.drill-edit').first();
    await block.getByRole('button', { name: '+ Add hit breakdown (A/C/D/miss)' }).click();

    const alphas = block.getByLabel('Alphas (A)', { exact: true });
    await expect(alphas).toHaveValue('');

    // − is disabled while the count is empty/zero.
    await expect(block.getByRole('button', { name: 'Decrease Alphas (A)' })).toBeDisabled();

    // Two taps of + → value 2 (controlled by state, so this proves onChange flowed through).
    await block.getByRole('button', { name: 'Increase Alphas (A)' }).click();
    await block.getByRole('button', { name: 'Increase Alphas (A)' }).click();
    await expect(alphas).toHaveValue('2');

    // − steps back down and floors at 0, then disables again.
    await block.getByRole('button', { name: 'Decrease Alphas (A)' }).click();
    await block.getByRole('button', { name: 'Decrease Alphas (A)' }).click();
    await expect(alphas).toHaveValue('0');
    await expect(block.getByRole('button', { name: 'Decrease Alphas (A)' })).toBeDisabled();
  });
});
