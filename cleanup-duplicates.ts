// Script to remove duplicate accounts from the database
import { pool } from './src/database/connection.js';
import logger from './src/utils/logger.js';

async function cleanupDuplicates() {
  try {
    logger.info('Starting duplicate account cleanup...');

    // Find duplicates (accounts with same provider_type and account_identifier)
    const duplicatesQuery = `
      SELECT 
        provider_type, 
        account_identifier,
        array_agg(id ORDER BY created_at ASC) as ids,
        COUNT(*) as count
      FROM accounts
      WHERE account_identifier IS NOT NULL
      GROUP BY provider_type, account_identifier
      HAVING COUNT(*) > 1
    `;

    const result = await pool.query(duplicatesQuery);

    if (result.rows.length === 0) {
      logger.info('No duplicates found');
      await pool.end();
      return;
    }

    logger.info({ duplicateGroups: result.rows.length }, 'Found duplicate account groups');

    // For each duplicate group, keep the first (oldest) and delete the rest
    for (const row of result.rows) {
      const ids = row.ids as string[];
      const keepId = ids[0]; // Keep the oldest
      const deleteIds = ids.slice(1); // Delete the rest

      logger.info({
        provider: row.provider_type,
        identifier: row.account_identifier,
        keeping: keepId,
        deleting: deleteIds,
      }, 'Removing duplicates');

      // Delete duplicate accounts
      for (const id of deleteIds) {
        await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
        logger.info({ id }, 'Deleted duplicate account');
      }
    }

    logger.info('Duplicate cleanup complete');
    await pool.end();
  } catch (error) {
    logger.error({ error }, 'Failed to cleanup duplicates');
    await pool.end();
    process.exit(1);
  }
}

cleanupDuplicates();
