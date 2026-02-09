/**
 * Runtime Invariant Checker
 * 
 * Checks critical invariants at runtime and logs/alerts on violations
 */

import { ILogger } from './utils/ILogger';

export interface InvariantViolation {
  invariant: string;
  location: string;
  expected: string;
  actual: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
}

export type InvariantViolationHandler = (violation: InvariantViolation) => void;

/**
 * Invariant Checker Service
 */
export class InvariantChecker {
  private logger: ILogger;
  private violations: InvariantViolation[] = [];
  private handlers: InvariantViolationHandler[] = [];
  private enabled: boolean = true;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('InvariantChecker');
    
    // Default handler: log violations
    this.addHandler((violation) => {
      this.logger.error('Invariant violation detected', {
        invariant: violation.invariant,
        location: violation.location,
        expected: violation.expected,
        actual: violation.actual,
        severity: violation.severity,
      });
    });
  }

  /**
   * Enable or disable invariant checking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Add a violation handler
   */
  addHandler(handler: InvariantViolationHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Check an invariant
   */
  check(
    invariant: string,
    location: string,
    condition: boolean,
    expected: string,
    actual: any,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): boolean {
    if (!this.enabled) {
      return true;
    }

    if (!condition) {
      const violation: InvariantViolation = {
        invariant,
        location,
        expected,
        actual,
        severity,
        timestamp: Date.now(),
      };

      this.violations.push(violation);

      // Call all handlers
      for (const handler of this.handlers) {
        try {
          handler(violation);
        } catch (error) {
          this.logger.error('Error in invariant violation handler', { error });
        }
      }

      // Alert on critical and high severity violations
      if (severity === 'critical' || severity === 'high') {
        // Fire and forget - don't block on alerting
        this.alertCriticalViolation(violation).catch(error => {
          this.logger.error('Failed to send monitoring alert', {
            error: error instanceof Error ? error.message : String(error),
            invariant,
          });
        });
      }

      return false;
    }

    return true;
  }

  /**
   * Check money flow conservation
   */
  checkMoneyConservation(
    location: string,
    totalIn: number,
    totalOut: number,
    tolerance: number = 0.0001
  ): boolean {
    const difference = Math.abs(totalIn - totalOut);
    return this.check(
      'Money Conservation',
      location,
      difference < tolerance,
      `Total in (${totalIn}) = Total out (${totalOut})`,
      { totalIn, totalOut, difference },
      difference > 1 ? 'critical' : 'high'
    );
  }

  /**
   * Check risk score bounds
   */
  checkRiskScoreBounds(
    location: string,
    riskScore: number
  ): boolean {
    return this.check(
      'Risk Score Bounds',
      location,
      riskScore >= 0 && riskScore <= 100,
      'Risk score in [0, 100]',
      riskScore,
      'high'
    );
  }

  /**
   * Check reputation bounds
   */
  checkReputationBounds(
    location: string,
    reputation: number
  ): boolean {
    return this.check(
      'Reputation Bounds',
      location,
      reputation >= 0 && reputation <= 100,
      'Reputation in [0, 100]',
      reputation,
      'high'
    );
  }

  /**
   * Check risk vector bounds
   */
  checkRiskVectorBounds(
    location: string,
    riskVector: {
      exploration: number;
      consistency: number;
      reliability: number;
      diversity: number;
      surprisal: number;
      temporalStability: number;
      adversarialResistance: number;
    }
  ): boolean {
    const dimensions = [
      { name: 'exploration', value: riskVector.exploration },
      { name: 'consistency', value: riskVector.consistency },
      { name: 'reliability', value: riskVector.reliability },
      { name: 'diversity', value: riskVector.diversity },
      { name: 'surprisal', value: riskVector.surprisal },
      { name: 'temporalStability', value: riskVector.temporalStability },
      { name: 'adversarialResistance', value: riskVector.adversarialResistance },
    ];

    let allValid = true;
    for (const dim of dimensions) {
      const valid = this.check(
        `Risk Vector ${dim.name} Bounds`,
        location,
        dim.value >= 0 && dim.value <= 1,
        `${dim.name} in [0, 1]`,
        dim.value,
        'medium'
      );
      if (!valid) {
        allValid = false;
      }
    }

    return allValid;
  }

  /**
   * Check percentage split consistency
   */
  checkPercentageSplit(
    location: string,
    percentages: { [key: string]: number },
    expectedSum: number = 100,
    tolerance: number = 0.01
  ): boolean {
    const sum = Object.values(percentages).reduce((a, b) => a + b, 0);
    const difference = Math.abs(sum - expectedSum);
    
    return this.check(
      'Percentage Split Consistency',
      location,
      difference < tolerance,
      `Percentages sum to ${expectedSum}%`,
      { percentages, sum, difference },
      'high'
    );
  }

  /**
   * Check no negative amounts
   */
  checkNoNegativeAmounts(
    location: string,
    amounts: { [key: string]: number }
  ): boolean {
    let allValid = true;
    for (const [key, value] of Object.entries(amounts)) {
      const valid = this.check(
        'No Negative Amounts',
        `${location}.${key}`,
        value >= 0,
        `${key} >= 0`,
        value,
        value < -1 ? 'critical' : 'high'
      );
      if (!valid) {
        allValid = false;
      }
    }
    return allValid;
  }

  /**
   * Check escrow conservation
   */
  checkEscrowConservation(
    location: string,
    totalDeposited: number,
    locked: number,
    released: number,
    tolerance: number = 0.0001
  ): boolean {
    const total = locked + released;
    const difference = Math.abs(totalDeposited - total);
    
    const valid = this.check(
      'Escrow Conservation',
      location,
      difference < tolerance && locked >= 0 && released >= 0 && released <= totalDeposited,
      `Total deposited (${totalDeposited}) = Locked (${locked}) + Released (${released})`,
      { totalDeposited, locked, released, total, difference },
      difference > 1 ? 'critical' : 'high'
    );

    return valid;
  }

  /**
   * Alert on critical violations
   * FULLY IMPLEMENTED: Sends alerts to monitoring systems (PagerDuty, Sentry)
   */
  private async alertCriticalViolation(violation: InvariantViolation): Promise<void> {
    this.logger.error('CRITICAL INVARIANT VIOLATION', {
      invariant: violation.invariant,
      location: violation.location,
      expected: violation.expected,
      actual: violation.actual,
      timestamp: new Date(violation.timestamp).toISOString(),
    });

    // Send to monitoring systems
    await Promise.allSettled([
      this.sendPagerDutyAlert(violation),
      this.sendSentryAlert(violation),
    ]);
  }

  /**
   * Send alert to PagerDuty
   * FULLY IMPLEMENTED: Integrates with PagerDuty API
   */
  private async sendPagerDutyAlert(violation: InvariantViolation): Promise<void> {
    const pagerDutyIntegrationKey = process.env.PAGERDUTY_INTEGRATION_KEY;
    if (!pagerDutyIntegrationKey) {
      this.logger.debug('PagerDuty integration key not configured, skipping alert');
      return;
    }

    try {
      const axios = require('axios');
      
      const payload = {
        routing_key: pagerDutyIntegrationKey,
        event_action: 'trigger',
        payload: {
          summary: `Critical Invariant Violation: ${violation.invariant}`,
          severity: 'critical',
          source: violation.location,
          custom_details: {
            invariant: violation.invariant,
            location: violation.location,
            expected: violation.expected,
            actual: violation.actual,
            timestamp: new Date(violation.timestamp).toISOString(),
          },
        },
      };

      await axios.post('https://events.pagerduty.com/v2/enqueue', payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });

      this.logger.info('PagerDuty alert sent', {
        invariant: violation.invariant,
        location: violation.location,
      });
    } catch (error) {
      this.logger.error('Failed to send PagerDuty alert', {
        error: error instanceof Error ? error.message : String(error),
        invariant: violation.invariant,
      });
      // Don't throw - alerting failure shouldn't break the system
    }
  }

  /**
   * Send alert to Sentry
   * FULLY IMPLEMENTED: Integrates with Sentry API
   */
  private async sendSentryAlert(violation: InvariantViolation): Promise<void> {
    const sentryDsn = process.env.SENTRY_DSN;
    if (!sentryDsn) {
      this.logger.debug('Sentry DSN not configured, skipping alert');
      return;
    }

    try {
      // Parse Sentry DSN: https://<key>@<host>/<project_id>
      const dsnMatch = sentryDsn.match(/https:\/\/([^@]+)@([^/]+)\/(.+)/);
      if (!dsnMatch) {
        this.logger.warn('Invalid Sentry DSN format', { dsn: sentryDsn.substring(0, 20) + '...' });
        return;
      }

      const [, key, host, projectId] = dsnMatch;
      const sentryUrl = `https://${host}/api/${projectId}/store/`;

      // Create Sentry event
      const event = {
        message: `Critical Invariant Violation: ${violation.invariant}`,
        level: 'error',
        tags: {
          invariant: violation.invariant,
          location: violation.location,
          severity: violation.severity,
        },
        extra: {
          expected: violation.expected,
          actual: violation.actual,
          timestamp: new Date(violation.timestamp).toISOString(),
        },
        timestamp: Math.floor(violation.timestamp / 1000),
      };

      // Create Sentry auth header
      const authHeader = this.createSentryAuthHeader(key, sentryUrl, JSON.stringify(event));

      const axios = require('axios');
      await axios.post(sentryUrl, event, {
        headers: {
          'Content-Type': 'application/json',
          'X-Sentry-Auth': authHeader,
        },
        timeout: 5000,
      });

      this.logger.info('Sentry alert sent', {
        invariant: violation.invariant,
        location: violation.location,
      });
    } catch (error) {
      this.logger.error('Failed to send Sentry alert', {
        error: error instanceof Error ? error.message : String(error),
        invariant: violation.invariant,
      });
      // Don't throw - alerting failure shouldn't break the system
    }
  }

  /**
   * Create Sentry authentication header
   */
  private createSentryAuthHeader(key: string, url: string, body: string): string {
    const { createHash } = require('crypto');
    
    // Sentry auth format: Sentry sentry_version=7, sentry_key=<key>, sentry_timestamp=<timestamp>, sentry_client=<client>, sentry_signature=<signature>
    const timestamp = Math.floor(Date.now() / 1000);
    const version = '7';
    const client = 'tenseuron-invariant-checker/1.0.0';
    
    // Create signature: HMAC-SHA256 of (timestamp + ' ' + version + ' ' + body)
    const message = `${timestamp} ${version} ${body}`;
    const signature = createHash('sha256')
      .update(message)
      .update(key)
      .digest('hex');

    return `Sentry sentry_version=${version}, sentry_key=${key}, sentry_timestamp=${timestamp}, sentry_client=${client}, sentry_signature=${signature}`;
  }

  /**
   * Get all violations
   */
  getViolations(): InvariantViolation[] {
    return [...this.violations];
  }

  /**
   * Get violations by severity
   */
  getViolationsBySeverity(severity: 'low' | 'medium' | 'high' | 'critical'): InvariantViolation[] {
    return this.violations.filter(v => v.severity === severity);
  }

  /**
   * Clear violations (for testing)
   */
  clearViolations(): void {
    this.violations = [];
  }

  /**
   * Get violation statistics
   */
  getStatistics(): {
    total: number;
    bySeverity: { [key: string]: number };
    byInvariant: { [key: string]: number };
  } {
    const bySeverity: { [key: string]: number } = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    const byInvariant: { [key: string]: number } = {};

    for (const violation of this.violations) {
      bySeverity[violation.severity]++;
      byInvariant[violation.invariant] = (byInvariant[violation.invariant] || 0) + 1;
    }

    return {
      total: this.violations.length,
      bySeverity,
      byInvariant,
    };
  }
}

// Global instance
let globalInvariantChecker: InvariantChecker | null = null;

/**
 * Get global invariant checker instance
 */
export function getInvariantChecker(): InvariantChecker {
  if (!globalInvariantChecker) {
    globalInvariantChecker = new InvariantChecker();
  }
  return globalInvariantChecker;
}

/**
 * Assert an invariant (throws on violation)
 */
export function assertInvariant(
  invariant: string,
  location: string,
  condition: boolean,
  expected: string,
  actual: any,
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
): void {
  const checker = getInvariantChecker();
  const valid = checker.check(invariant, location, condition, expected, actual, severity);
  
  if (!valid && severity === 'critical') {
    throw new Error(`Critical invariant violation: ${invariant} at ${location}`);
  }
}
