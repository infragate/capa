#!/usr/bin/env bun
/**
 * Generate schema/capabilities.schema.json from the zod schema capa validates
 * the capabilities file with, so editors get autocomplete and validation.
 * Run after changing src/shared/capabilities.ts; a test fails when it drifts.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildCapabilitiesJsonSchema } from '../src/shared/capabilities';

const outputPath = join(import.meta.dir, '..', 'schema', 'capabilities.schema.json');
writeFileSync(outputPath, `${JSON.stringify(buildCapabilitiesJsonSchema(), null, 2)}\n`, 'utf-8');
console.log(`✓ Generated ${outputPath}`);
