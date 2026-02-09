/**
 * Penalty Configuration Validator
 * 
 * Validates penalty configurations to ensure they are safe and logical
 */

import { ILogger } from './utils/ILogger';
import { NetworkManifest } from './types';

export interface PenaltyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class PenaltyConfigValidator {
  private logger: ILogger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('PenaltyConfigValidator');
  }

  /**
   * Validate penalty configuration
   */
  validate(penaltyConfig: NetworkManifest['penaltyConfig']): PenaltyValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!penaltyConfig) {
      errors.push('Penalty configuration is required');
      return { valid: false, errors, warnings };
    }

    // Validate mechanism
    const validMechanisms = ['slashing', 'reputation-only', 'temporary-ban', 'warning-system', 'hybrid', 'none'];
    if (!validMechanisms.includes(penaltyConfig.mechanism)) {
      errors.push(`Invalid penalty mechanism: ${penaltyConfig.mechanism}. Must be one of: ${validMechanisms.join(', ')}`);
    }

    // Validate slashing config (if mechanism includes slashing)
    if (penaltyConfig.mechanism === 'slashing' || penaltyConfig.mechanism === 'hybrid') {
      if (!penaltyConfig.slashing) {
        errors.push('Slashing configuration is required when mechanism is "slashing" or "hybrid"');
      } else {
        const slashingErrors = this.validateSlashing(penaltyConfig.slashing);
        errors.push(...slashingErrors);
      }
    }

    // Validate reputation config (if mechanism includes reputation)
    if (penaltyConfig.mechanism === 'reputation-only' || penaltyConfig.mechanism === 'hybrid') {
      if (!penaltyConfig.reputation) {
        errors.push('Reputation configuration is required when mechanism is "reputation-only" or "hybrid"');
      } else {
        const reputationErrors = this.validateReputation(penaltyConfig.reputation);
        errors.push(...reputationErrors);
      }
    }

    // Validate temporary ban config (if mechanism includes ban)
    if (penaltyConfig.mechanism === 'temporary-ban' || penaltyConfig.mechanism === 'hybrid') {
      if (!penaltyConfig.temporaryBan) {
        errors.push('Temporary ban configuration is required when mechanism is "temporary-ban" or "hybrid"');
      } else {
        const banErrors = this.validateTemporaryBan(penaltyConfig.temporaryBan);
        errors.push(...banErrors);
      }
    }

    // Validate warning system config (if mechanism includes warnings)
    if (penaltyConfig.mechanism === 'warning-system' || penaltyConfig.mechanism === 'hybrid') {
      if (!penaltyConfig.warningSystem) {
        errors.push('Warning system configuration is required when mechanism is "warning-system" or "hybrid"');
      } else {
        const warningErrors = this.validateWarningSystem(penaltyConfig.warningSystem);
        errors.push(...warningErrors);
      }
    }

    // Validate hybrid config
    if (penaltyConfig.mechanism === 'hybrid') {
      if (!penaltyConfig.hybrid) {
        errors.push('Hybrid configuration is required when mechanism is "hybrid"');
      } else {
        const hybridErrors = this.validateHybrid(penaltyConfig.hybrid, penaltyConfig);
        errors.push(...hybridErrors);
      }
    }

    // Check for logical inconsistencies
    const logicalWarnings = this.checkLogicalConsistency(penaltyConfig);
    warnings.push(...logicalWarnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate slashing configuration
   */
  private validateSlashing(slashing: NonNullable<NetworkManifest['penaltyConfig']['slashing']>): string[] {
    const errors: string[] = [];

    if (slashing.enabled) {
      if (slashing.rate < 0 || slashing.rate > 100) {
        errors.push('Slashing rate must be between 0 and 100 (percentage)');
      }
      if (slashing.rate > 50) {
        errors.push('Slashing rate above 50% is extremely punitive and may deter validators');
      }
      if (parseFloat(slashing.minStakeRequired) < 0) {
        errors.push('Minimum stake required cannot be negative');
      }
      if (slashing.cooldownPeriod < 0) {
        errors.push('Cooldown period cannot be negative');
      }
      if (slashing.cooldownPeriod > 90 * 24 * 60 * 60) {
        errors.push('Cooldown period should not exceed 90 days');
      }
    }

    return errors;
  }

  /**
   * Validate reputation configuration
   */
  private validateReputation(reputation: NonNullable<NetworkManifest['penaltyConfig']['reputation']>): string[] {
    const errors: string[] = [];

    if (reputation.enabled) {
      if (reputation.penaltyPerOffense < 0 || reputation.penaltyPerOffense > 100) {
        errors.push('Reputation penalty per offense must be between 0 and 100');
      }
      if (reputation.minReputationForBan < 0 || reputation.minReputationForBan > 100) {
        errors.push('Minimum reputation for ban must be between 0 and 100');
      }
      if (reputation.recoveryRate < 0 || reputation.recoveryRate > 1) {
        errors.push('Recovery rate must be between 0 and 1 (0-100%)');
      }
      if (reputation.minReputationForBan > 50) {
        errors.push('Minimum reputation for ban above 50 may be too strict');
      }
    }

    return errors;
  }

  /**
   * Validate temporary ban configuration
   */
  private validateTemporaryBan(temporaryBan: NonNullable<NetworkManifest['penaltyConfig']['temporaryBan']>): string[] {
    const errors: string[] = [];

    if (temporaryBan.enabled) {
      if (temporaryBan.banDuration < 0) {
        errors.push('Ban duration cannot be negative');
      }
      if (temporaryBan.banDuration > 365 * 24 * 60 * 60) {
        errors.push('Ban duration should not exceed 1 year');
      }
      if (temporaryBan.offensesBeforeBan < 1) {
        errors.push('Offenses before ban must be at least 1');
      }
      if (temporaryBan.escalationFactor < 1) {
        errors.push('Escalation factor must be at least 1');
      }
      if (temporaryBan.escalationFactor > 10) {
        errors.push('Escalation factor above 10x may be too punitive');
      }
    }

    return errors;
  }

  /**
   * Validate warning system configuration
   */
  private validateWarningSystem(warningSystem: NonNullable<NetworkManifest['penaltyConfig']['warningSystem']>): string[] {
    const errors: string[] = [];

    if (warningSystem.enabled) {
      if (warningSystem.warningsBeforeAction < 1) {
        errors.push('Warnings before action must be at least 1');
      }
      if (warningSystem.warningExpiry < 0) {
        errors.push('Warning expiry cannot be negative');
      }
      if (warningSystem.warningExpiry > 365 * 24 * 60 * 60) {
        errors.push('Warning expiry should not exceed 1 year');
      }
      const validActions = ['reputation', 'ban', 'slash'];
      if (!validActions.includes(warningSystem.actionAfterWarnings)) {
        errors.push(`Action after warnings must be one of: ${validActions.join(', ')}`);
      }
    }

    return errors;
  }

  /**
   * Validate hybrid configuration
   */
  private validateHybrid(
    hybrid: NonNullable<NetworkManifest['penaltyConfig']['hybrid']>,
    penaltyConfig: NetworkManifest['penaltyConfig']
  ): string[] {
    const errors: string[] = [];

    const validOffenseActions = ['warning', 'reputation', 'slash', 'ban', 'permanent-ban'];
    
    if (!validOffenseActions.includes(hybrid.firstOffense)) {
      errors.push(`First offense action must be one of: ${validOffenseActions.join(', ')}`);
    }
    if (!validOffenseActions.includes(hybrid.secondOffense)) {
      errors.push(`Second offense action must be one of: ${validOffenseActions.join(', ')}`);
    }
    if (!validOffenseActions.includes(hybrid.thirdOffense)) {
      errors.push(`Third offense action must be one of: ${validOffenseActions.join(', ')}`);
    }
    if (hybrid.permanentBanThreshold < 1) {
      errors.push('Permanent ban threshold must be at least 1');
    }

    // Check that required mechanisms are enabled
    if (hybrid.firstOffense === 'slash' && !penaltyConfig.slashing?.enabled) {
      errors.push('Slashing must be enabled if first offense is "slash"');
    }
    if (hybrid.secondOffense === 'slash' && !penaltyConfig.slashing?.enabled) {
      errors.push('Slashing must be enabled if second offense is "slash"');
    }
    if (hybrid.thirdOffense === 'slash' && !penaltyConfig.slashing?.enabled) {
      errors.push('Slashing must be enabled if third offense is "slash"');
    }
    if ((hybrid.firstOffense === 'reputation' || hybrid.secondOffense === 'reputation') && !penaltyConfig.reputation?.enabled) {
      errors.push('Reputation must be enabled if any offense uses "reputation"');
    }
    if ((hybrid.secondOffense === 'ban' || hybrid.thirdOffense === 'ban') && !penaltyConfig.temporaryBan?.enabled) {
      errors.push('Temporary ban must be enabled if any offense uses "ban"');
    }
    if (hybrid.firstOffense === 'warning' && !penaltyConfig.warningSystem?.enabled) {
      errors.push('Warning system must be enabled if first offense is "warning"');
    }

    return errors;
  }

  /**
   * Check for logical inconsistencies
   */
  private checkLogicalConsistency(penaltyConfig: NetworkManifest['penaltyConfig']): string[] {
    const warnings: string[] = [];

    // Warn if mechanism is 'none' but other configs are provided
    if (penaltyConfig.mechanism === 'none' && (penaltyConfig.slashing || penaltyConfig.reputation || penaltyConfig.temporaryBan || penaltyConfig.warningSystem)) {
      warnings.push('Penalty mechanism is "none" but other penalty configurations are provided (they will be ignored)');
    }

    // Warn if slashing rate is very low
    if (penaltyConfig.slashing?.enabled && penaltyConfig.slashing.rate < 5) {
      warnings.push('Slashing rate is very low (<5%), may not be an effective deterrent');
    }

    // Warn if reputation recovery is very slow
    if (penaltyConfig.reputation?.enabled && penaltyConfig.reputation.recoveryRate < 0.001) {
      warnings.push('Reputation recovery rate is very slow, validators may take a very long time to recover');
    }

    // Warn if ban duration is very short
    if (penaltyConfig.temporaryBan?.enabled && penaltyConfig.temporaryBan.banDuration < 3600) {
      warnings.push('Ban duration is very short (<1 hour), may not be an effective deterrent');
    }

    // Warn if warnings expire too quickly
    if (penaltyConfig.warningSystem?.enabled && penaltyConfig.warningSystem.warningExpiry < 86400) {
      warnings.push('Warning expiry is very short (<1 day), warnings may expire before validators can improve');
    }

    return warnings;
  }
}
