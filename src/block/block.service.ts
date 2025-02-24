// src/block/block.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { RedisService } from 'src/redis/redis.service';
import * as crypto from 'crypto';
import { BlockType } from './dto/block.dto';

@Injectable()
export class BlockService {
    private readonly logger = new Logger(BlockService.name);
    private fullNodeUrl: string;

    private readonly BLOCKS_KEY = 'blockchain:blocks'; // Clave Redis para almacenar bloques
    private readonly HEIGHT_KEY = 'blockchain:height'; // Clave Redis para almacenar la altura de la blockchain
    private readonly TX_INDEX_KEY = 'blockchain:tx-index'; // Clave Redis para indexar transacciones

    constructor(private readonly redis: RedisService) {
        this.fullNodeUrl = process.env.FULL_NODE_URL || 'http://localhost:3001';
    }

    async getBlock(hash: string): Promise<any> {
        try {
            const response = await axios.get(`${this.fullNodeUrl}/blocks/${hash}`);
            return response.data;
        } catch (error) {
            this.logger.error(`Error getting block ${hash}: ${error.message}`);
            throw error;
        }
    }

    async getBlockHeight(): Promise<number> {
        try {
            const response = await axios.get(`${this.fullNodeUrl}/blocks/height`);
            return response.data.height;
        } catch (error) {
            this.logger.error(`Error getting block height: ${error.message}`);
            throw error;
        }
    }

    async getMempoolTransactions(): Promise<any[]> {
        try {
            const response = await axios.get(`${this.fullNodeUrl}/mempool`);
            return response.data.transactions;
        } catch (error) {
            this.logger.error(`Error getting mempool transactions: ${error.message}`);
            throw error;
        }
    }

    async getBlockFromMempool(): Promise<any> {
        try {
            const transactions = await this.getMempoolTransactions();
            if (!transactions || transactions.length === 0) {
                return null;
            }

            // Construir un bloque temporal con las transacciones del mempool
            const previousBlock = await this.getBlockByHeight(await this.getBlockHeight());
            const newBlock = {
                index: previousBlock.index + 1,
                timestamp: new Date().toISOString(),
                type: BlockType.TRANSACTION,
                transactions: transactions,
                previousHash: previousBlock.hash,
                hash: '', // Este valor será calculado después
                nonce: 0,
                signature: '', // Este valor será firmado después
                validator: '', // Este valor será asignado después
            };

            // Calcular el hash del bloque
            newBlock.hash = this.calculateHash(newBlock);

            return newBlock;
        } catch (error) {
            this.logger.error(`Error getting block from mempool: ${error.message}`);
            throw error;
        }
    }

    async proposeNewBlock(transactions: any[]): Promise<any> {
        try {
            const response = await axios.post(`${this.fullNodeUrl}/blocks`, { transactions });
            return response.data;
        } catch (error) {
            this.logger.error(`Error proposing new block: ${error.message}`);
            throw error;
        }
    }

    async saveBlock(block: any): Promise<void> {
        try {
            // Validar el bloque antes de guardarlo
            if (!await this.isValidBlock(block)) {
                throw new Error('Invalid block');
            }

            // Guardar el bloque en Redis
            await this.redis.hSet(
                this.BLOCKS_KEY,
                block.hash,
                JSON.stringify(block)
            );

            // Actualizar índices relacionados con la altura
            await this.redis.set(`${this.HEIGHT_KEY}:${block.index}`, block.hash);
            await this.redis.set(this.HEIGHT_KEY, block.index.toString());

            // Indexar transacciones si existen
            if (block.transactions) {
                for (const tx of block.transactions) {
                    await this.redis.hSet(
                        this.TX_INDEX_KEY,
                        tx.processId,
                        block.hash
                    );
                }
            }

            // Registrar el bloque en la altura actual
            this.logger.log(`Block saved successfully: ${block.hash}`);
        } catch (error) {
            this.logger.error(`Error saving block: ${error.message}`);
            throw error;
        }
    }

    public async isValidBlock(block: any): Promise<boolean> {
        try {
            // Verificar que el hash del bloque sea correcto
            const calculatedHash = this.calculateHash(block);
            if (block.hash !== calculatedHash) {
                this.logger.warn(`Invalid block hash for block ${block.hash}`);
                return false;
            }

            // Verificar que el bloque anterior exista y coincida con el hash previo
            if (block.index > 0) {
                const previousBlock = await this.getBlockByHeight(block.index - 1);
                if (!previousBlock || previousBlock.hash !== block.previousHash) {
                    this.logger.warn(`Invalid previous hash for block ${block.hash}`);
                    return false;
                }
            }

            // Verificar que el índice del bloque sea correcto
            const currentHeight = await this.getBlockHeight();
            if (block.index !== currentHeight + 1) {
                this.logger.warn(`Invalid block index for block ${block.hash}`);
                return false;
            }

            return true;
        } catch (error) {
            this.logger.error(`Error validating block: ${error.message}`);
            return false;
        }
    }

    private async getBlockByHeight(height: number): Promise<any> {
        try {
            const blockHash = await this.redis.get(`${this.HEIGHT_KEY}:${height}`);
            return blockHash ? this.getBlock(blockHash) : undefined;
        } catch (error) {
            this.logger.error(`Error getting block by height: ${error.message}`);
            throw error;
        }
    }

    private calculateHash(block: any): string {
        return crypto
            .createHash('sha256')
            .update(
                block.index +
                block.previousHash +
                block.timestamp +
                JSON.stringify(block.transactions || []) +
                JSON.stringify(block.criticalProcesses || []) +
                block.nonce +
                block.signature
            )
            .digest('hex');
    }
}