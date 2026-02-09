/**
 * D1 Validator Interaction Repository
 * 
 * Cloudflare D1 (SQLite) implementation of IValidatorInteractionRepository
 */

import {
    IValidatorInteractionRepository,
    ValidatorInteractionData,
    InteractionFrequencyData
} from '../../interfaces/IValidatorInteractionRepository';

export class D1ValidatorInteractionRepository implements IValidatorInteractionRepository {
    constructor(private db: D1Database) { }

    async recordInteraction(data: Omit<ValidatorInteractionData, 'id' | 'timestamp'>): Promise<ValidatorInteractionData> {
        const id = crypto.randomUUID();
        const timestamp = new Date();

        await this.db.prepare(`
            INSERT INTO validator_interactions (
                id, networkId, validator1, validator2, taskId, agreement, metadata, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            id,
            data.networkId,
            data.validator1,
            data.validator2,
            data.taskId,
            data.agreement ? 1 : 0,
            data.metadata ? JSON.stringify(data.metadata) : null,
            timestamp.toISOString()
        ).run();

        return {
            id,
            networkId: data.networkId,
            validator1: data.validator1,
            validator2: data.validator2,
            taskId: data.taskId,
            agreement: data.agreement,
            timestamp,
            metadata: data.metadata,
        };
    }

    async findByValidators(
        validator1: string,
        validator2: string,
        networkId?: string,
        limit: number = 100
    ): Promise<ValidatorInteractionData[]> {
        let query = `
            SELECT * FROM validator_interactions
            WHERE ((validator1 = ? AND validator2 = ?) OR (validator1 = ? AND validator2 = ?))
        `;
        const bindings: any[] = [validator1, validator2, validator2, validator1];

        if (networkId) {
            query += ` AND networkId = ?`;
            bindings.push(networkId);
        }

        query += ` ORDER BY timestamp DESC LIMIT ?`;
        bindings.push(limit);

        const result = await this.db.prepare(query).bind(...bindings).all();

        return result.results.map(row => this.mapToInteraction(row));
    }

    async findByValidator(
        validatorAddress: string,
        networkId?: string,
        limit: number = 100
    ): Promise<ValidatorInteractionData[]> {
        let query = `
            SELECT * FROM validator_interactions
            WHERE (validator1 = ? OR validator2 = ?)
        `;
        const bindings: any[] = [validatorAddress, validatorAddress];

        if (networkId) {
            query += ` AND networkId = ?`;
            bindings.push(networkId);
        }

        query += ` ORDER BY timestamp DESC LIMIT ?`;
        bindings.push(limit);

        const result = await this.db.prepare(query).bind(...bindings).all();

        return result.results.map(row => this.mapToInteraction(row));
    }

    async getInteractionFrequency(
        validator1: string,
        validator2: string,
        networkId: string
    ): Promise<InteractionFrequencyData | null> {
        const interactions = await this.findByValidators(validator1, validator2, networkId, 1000);

        if (interactions.length === 0) {
            return null;
        }

        const agreementCount = interactions.filter(i => i.agreement).length;
        const disagreementCount = interactions.length - agreementCount;
        const agreementRate = agreementCount / interactions.length;
        const lastInteraction = interactions[0].timestamp;

        return {
            validator1,
            validator2,
            networkId,
            totalInteractions: interactions.length,
            agreementCount,
            disagreementCount,
            agreementRate,
            lastInteraction,
        };
    }

    async getHighAgreementPairs(
        networkId: string,
        minInteractions: number,
        minAgreementRate: number
    ): Promise<InteractionFrequencyData[]> {
        // Get all interactions for the network
        const result = await this.db.prepare(`
            SELECT * FROM validator_interactions
            WHERE networkId = ?
        `).bind(networkId).all();

        const interactions = result.results.map(row => this.mapToInteraction(row));

        // Group by validator pairs
        const pairMap = new Map<string, ValidatorInteractionData[]>();

        for (const interaction of interactions) {
            const key = [interaction.validator1, interaction.validator2].sort().join('-');
            if (!pairMap.has(key)) {
                pairMap.set(key, []);
            }
            pairMap.get(key)!.push(interaction);
        }

        // Calculate frequencies and filter
        const highAgreementPairs: InteractionFrequencyData[] = [];

        for (const [key, pairInteractions] of pairMap.entries()) {
            if (pairInteractions.length < minInteractions) {
                continue;
            }

            const agreementCount = pairInteractions.filter(i => i.agreement).length;
            const agreementRate = agreementCount / pairInteractions.length;

            if (agreementRate >= minAgreementRate) {
                const [validator1, validator2] = key.split('-');
                highAgreementPairs.push({
                    validator1,
                    validator2,
                    networkId,
                    totalInteractions: pairInteractions.length,
                    agreementCount,
                    disagreementCount: pairInteractions.length - agreementCount,
                    agreementRate,
                    lastInteraction: pairInteractions[0].timestamp,
                });
            }
        }

        return highAgreementPairs.sort((a, b) => b.agreementRate - a.agreementRate);
    }

    async getValidatorStats(
        validatorAddress: string,
        networkId: string
    ): Promise<{
        totalInteractions: number;
        uniquePartners: number;
        averageAgreementRate: number;
    }> {
        const interactions = await this.findByValidator(validatorAddress, networkId, 10000);

        if (interactions.length === 0) {
            return {
                totalInteractions: 0,
                uniquePartners: 0,
                averageAgreementRate: 0,
            };
        }

        const partners = new Set<string>();
        let totalAgreements = 0;

        for (const interaction of interactions) {
            const partner = interaction.validator1 === validatorAddress
                ? interaction.validator2
                : interaction.validator1;
            partners.add(partner);
            if (interaction.agreement) {
                totalAgreements++;
            }
        }

        return {
            totalInteractions: interactions.length,
            uniquePartners: partners.size,
            averageAgreementRate: totalAgreements / interactions.length,
        };
    }

    async deleteOldInteractions(beforeDate: Date): Promise<number> {
        const result = await this.db.prepare(`
            DELETE FROM validator_interactions
            WHERE timestamp < ?
        `).bind(beforeDate.toISOString()).run();

        return result.meta.changes || 0;
    }

    private mapToInteraction(row: any): ValidatorInteractionData {
        return {
            id: row.id,
            networkId: row.networkId,
            validator1: row.validator1,
            validator2: row.validator2,
            taskId: row.taskId,
            agreement: Boolean(row.agreement),
            timestamp: new Date(row.timestamp),
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        };
    }
}
