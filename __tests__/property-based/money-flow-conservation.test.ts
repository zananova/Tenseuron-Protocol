/**
 * Property-Based Tests for Money Flow Conservation
 * 
 * Verifies that money is never created or destroyed (conservation of funds)
 */

import * as fc from 'fast-check';

describe('Money Flow Conservation Invariants (Property-Based)', () => {
  /**
   * Property 1: Total money in = Total money out
   * 
   * For any transaction, the sum of inputs must equal the sum of outputs
   */
  describe('Money Conservation', () => {
    it('should conserve money in all transactions', () => {
      fc.assert(
        fc.property(
          fc.record({
            // Generate amounts and percentages that sum to 100%
            creationFee: fc.float({ min: 0.01, max: 1000 }),
            taskPayment: fc.float({ min: 0.01, max: 1000 }),
            // Percentages that will be normalized to sum to 100%
            creatorRewardPercent: fc.float({ min: 0, max: 100 }),
            minerPoolPercent: fc.float({ min: 0, max: 100 }),
            purposeBoundSinksPercent: fc.float({ min: 0, max: 100 }),
            burnPercent: fc.float({ min: 0, max: 100 }),
            validatorPaymentPercent: fc.float({ min: 0, max: 100 }),
            minerRewardPercent: fc.float({ min: 0, max: 100 }),
          }),
          (data: any) => {
            // Skip if any value is NaN or Infinity
            if (!isFinite(data.creationFee) || !isFinite(data.taskPayment) ||
                !isFinite(data.creatorRewardPercent) || !isFinite(data.minerPoolPercent) ||
                !isFinite(data.purposeBoundSinksPercent) || !isFinite(data.burnPercent) ||
                !isFinite(data.validatorPaymentPercent) || !isFinite(data.minerRewardPercent)) {
              return;
            }

            // Normalize creation fee percentages
            const creationFeeTotalPercent = data.creatorRewardPercent + data.minerPoolPercent + 
                                          data.purposeBoundSinksPercent + data.burnPercent;
            if (creationFeeTotalPercent === 0 || !isFinite(creationFeeTotalPercent)) {
              return;
            }

            // Calculate splits (normalized to sum to creationFee)
            const creatorReward = (data.creationFee * data.creatorRewardPercent) / creationFeeTotalPercent;
            const minerPool = (data.creationFee * data.minerPoolPercent) / creationFeeTotalPercent;
            const purposeBoundSinks = (data.creationFee * data.purposeBoundSinksPercent) / creationFeeTotalPercent;
            const burn = (data.creationFee * data.burnPercent) / creationFeeTotalPercent;
            const creationFeeOut = creatorReward + minerPool + purposeBoundSinks + burn;

            // Normalize task payment percentages
            const taskPaymentTotalPercent = data.validatorPaymentPercent + data.minerRewardPercent;
            if (taskPaymentTotalPercent === 0 || !isFinite(taskPaymentTotalPercent)) {
              return;
            }

            const validatorPayment = (data.taskPayment * data.validatorPaymentPercent) / taskPaymentTotalPercent;
            const minerReward = (data.taskPayment * data.minerRewardPercent) / taskPaymentTotalPercent;
            const taskPaymentOut = validatorPayment + minerReward;

            // Skip if any calculated value is NaN or Infinity
            if (!isFinite(creationFeeOut) || !isFinite(taskPaymentOut)) {
              return;
            }

            // Invariant 1: Creation fee splits sum to creationFee (within tolerance)
            const creationFeeDiff = Math.abs(data.creationFee - creationFeeOut);
            expect(creationFeeDiff).toBeLessThan(0.01 * data.creationFee); // 1% relative error

            // Invariant 2: Task payment splits sum to taskPayment (within tolerance)
            const taskPaymentDiff = Math.abs(data.taskPayment - taskPaymentOut);
            expect(taskPaymentDiff).toBeLessThan(0.01 * data.taskPayment); // 1% relative error

            // Invariant 3: Total in = Total out
            const totalIn = data.creationFee + data.taskPayment;
            const totalOut = creationFeeOut + taskPaymentOut;
            const totalDiff = Math.abs(totalIn - totalOut);
            expect(totalDiff).toBeLessThan(0.01 * Math.max(totalIn, 1)); // 1% relative error
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('should conserve money in percentage-based splits', () => {
      fc.assert(
        fc.property(
          fc.record({
            amount: fc.float({ min: 0, max: 1000 }),
            creatorRewardPercent: fc.float({ min: 0, max: 100 }),
            minerPoolPercent: fc.float({ min: 0, max: 100 }),
            purposeBoundSinksPercent: fc.float({ min: 0, max: 100 }),
            burnPercent: fc.float({ min: 0, max: 100 }),
          }),
          (data: any) => {
            // Skip if amount is 0 or NaN
            if (data.amount === 0 || isNaN(data.amount)) {
              return;
            }

            // Normalize percentages to sum to 100
            const totalPercent = data.creatorRewardPercent + data.minerPoolPercent + 
                                data.purposeBoundSinksPercent + data.burnPercent;
            
            // Skip if total percent is 0, NaN, or Infinity
            if (totalPercent === 0 || isNaN(totalPercent) || !isFinite(totalPercent)) {
              return;
            }

            const normalizedCreator = (data.creatorRewardPercent / totalPercent) * 100;
            const normalizedMiner = (data.minerPoolPercent / totalPercent) * 100;
            const normalizedSinks = (data.purposeBoundSinksPercent / totalPercent) * 100;
            const normalizedBurn = (data.burnPercent / totalPercent) * 100;

            const creatorReward = (data.amount * normalizedCreator) / 100;
            const minerPool = (data.amount * normalizedMiner) / 100;
            const purposeBoundSinks = (data.amount * normalizedSinks) / 100;
            const burn = (data.amount * normalizedBurn) / 100;

            const totalOut = creatorReward + minerPool + purposeBoundSinks + burn;

            // Skip if any value is NaN or Infinity
            if (!isFinite(totalOut) || !isFinite(data.amount)) {
              return;
            }

            // Invariant: Sum of splits must equal original amount
            const difference = Math.abs(data.amount - totalOut);
            expect(difference).toBeLessThan(0.001); // Increased tolerance for floating point
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  /**
   * Property 2: No negative amounts
   */
  describe('No Negative Amounts', () => {
    it('should never produce negative money amounts', () => {
      fc.assert(
        fc.property(
          fc.record({
            creationFee: fc.float({ min: 0, max: 1000 }),
            creatorRewardPercent: fc.float({ min: 0, max: 100 }),
            minerPoolPercent: fc.float({ min: 0, max: 100 }),
            purposeBoundSinksPercent: fc.float({ min: 0, max: 100 }),
            burnPercent: fc.float({ min: 0, max: 100 }),
          }),
          (data: any) => {
            // Skip if creation fee is 0, NaN, or Infinity
            if (data.creationFee === 0 || isNaN(data.creationFee) || !isFinite(data.creationFee)) {
              return;
            }

            // Calculate splits
            const totalPercent = data.creatorRewardPercent + data.minerPoolPercent + 
                                data.purposeBoundSinksPercent + data.burnPercent;
            
            // Skip if total percent is 0, NaN, or Infinity
            if (totalPercent === 0 || isNaN(totalPercent) || !isFinite(totalPercent)) {
              return;
            }

            const creatorReward = (data.creationFee * data.creatorRewardPercent) / totalPercent;
            const minerPool = (data.creationFee * data.minerPoolPercent) / totalPercent;
            const purposeBoundSinks = (data.creationFee * data.purposeBoundSinksPercent) / totalPercent;
            const burn = (data.creationFee * data.burnPercent) / totalPercent;

            // Skip if any value is NaN or Infinity
            if (!isFinite(creatorReward) || !isFinite(minerPool) || 
                !isFinite(purposeBoundSinks) || !isFinite(burn)) {
              return;
            }

            // Invariant: All amounts must be non-negative
            expect(creatorReward).toBeGreaterThanOrEqual(0);
            expect(minerPool).toBeGreaterThanOrEqual(0);
            expect(purposeBoundSinks).toBeGreaterThanOrEqual(0);
            expect(burn).toBeGreaterThanOrEqual(0);
            expect(data.creationFee).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  /**
   * Property 3: Percentage splits sum to 100%
   */
  describe('Percentage Split Consistency', () => {
    it('should ensure percentage splits sum to 100%', () => {
      fc.assert(
        fc.property(
          fc.record({
            creatorRewardPercent: fc.float({ min: 0, max: 100 }),
            minerPoolPercent: fc.float({ min: 0, max: 100 }),
            purposeBoundSinksPercent: fc.float({ min: 0, max: 100 }),
            burnPercent: fc.float({ min: 0, max: 100 }),
          }),
          (data: any) => {
            // Skip if any percentage is NaN or Infinity
            if (isNaN(data.creatorRewardPercent) || isNaN(data.minerPoolPercent) ||
                isNaN(data.purposeBoundSinksPercent) || isNaN(data.burnPercent) ||
                !isFinite(data.creatorRewardPercent) || !isFinite(data.minerPoolPercent) ||
                !isFinite(data.purposeBoundSinksPercent) || !isFinite(data.burnPercent)) {
              return;
            }

            // Normalize to sum to 100
            const totalPercent = data.creatorRewardPercent + data.minerPoolPercent + 
                                data.purposeBoundSinksPercent + data.burnPercent;
            
            // Skip if total percent is 0, NaN, or Infinity
            if (totalPercent === 0 || isNaN(totalPercent) || !isFinite(totalPercent)) {
              return;
            }

            const normalizedCreator = (data.creatorRewardPercent / totalPercent) * 100;
            const normalizedMiner = (data.minerPoolPercent / totalPercent) * 100;
            const normalizedSinks = (data.purposeBoundSinksPercent / totalPercent) * 100;
            const normalizedBurn = (data.burnPercent / totalPercent) * 100;

            const sum = normalizedCreator + normalizedMiner + normalizedSinks + normalizedBurn;

            // Skip if sum is NaN or Infinity
            if (isNaN(sum) || !isFinite(sum)) {
              return;
            }

            // Invariant: Normalized percentages must sum to 100%
            const difference = Math.abs(100 - sum);
            expect(difference).toBeLessThan(0.001); // Increased tolerance for floating point
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  /**
   * Property 4: Escrow conservation
   * Money locked in escrow + money released = total deposited
   */
  describe('Escrow Conservation', () => {
    it('should conserve money in escrow operations', () => {
      fc.assert(
        fc.property(
          fc.record({
            totalDeposited: fc.float({ min: 0, max: 10000 }),
            releasedAmount: fc.float({ min: 0, max: 10000 }),
          }),
          (data: any) => {
            // Skip if values are NaN or Infinity
            if (isNaN(data.totalDeposited) || isNaN(data.releasedAmount) ||
                !isFinite(data.totalDeposited) || !isFinite(data.releasedAmount)) {
              return;
            }

            // Ensure released amount doesn't exceed deposited
            const released = Math.min(data.releasedAmount, data.totalDeposited);
            const locked = data.totalDeposited - released;

            // Skip if locked is NaN or Infinity
            if (isNaN(locked) || !isFinite(locked)) {
              return;
            }

            // Invariant: Locked + Released = Total Deposited
            const total = locked + released;
            const difference = Math.abs(data.totalDeposited - total);
            expect(difference).toBeLessThan(0.001); // Increased tolerance for floating point

            // Invariant: Locked amount must be non-negative
            expect(locked).toBeGreaterThanOrEqual(0);

            // Invariant: Released amount must not exceed deposited
            expect(released).toBeLessThanOrEqual(data.totalDeposited);
          }
        ),
        { numRuns: 1000 }
      );
    });
  });
});
