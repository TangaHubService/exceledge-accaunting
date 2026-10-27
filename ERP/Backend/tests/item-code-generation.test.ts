import { describe, it, expect } from 'vitest';
import {
  buildItemCd,
  itemTypeCodeDigit,
  deriveQtyUnitCd,
  DEFAULT_PKG_UNIT_CD,
} from '../src/services/item-code.service';
import { ItemType } from '@prisma/client';
import { VALID_RRA_COUNTRY_CODES, isValidRraCountryCode, getRraCountryName } from '../src/constants/rra-country-codes';

describe('RRA itemCd generation', () => {
  describe('itemTypeCodeDigit', () => {
    it('maps RAW_MATERIAL to 1', () => {
      expect(itemTypeCodeDigit('RAW_MATERIAL')).toBe('1');
    });

    it('maps PRODUCT to 2', () => {
      expect(itemTypeCodeDigit('PRODUCT')).toBe('2');
    });

    it('maps SERVICE to 3', () => {
      expect(itemTypeCodeDigit('SERVICE')).toBe('3');
    });
  });

  describe('deriveQtyUnitCd', () => {
    it('maps PCS to U', () => {
      expect(deriveQtyUnitCd('PCS')).toBe('U');
    });

    it('maps KG to KG', () => {
      expect(deriveQtyUnitCd('KG')).toBe('KG');
    });

    it('maps LTR to LTR', () => {
      expect(deriveQtyUnitCd('LTR')).toBe('LTR');
    });

    it('maps MTR to MTR', () => {
      expect(deriveQtyUnitCd('MTR')).toBe('MTR');
    });

    it('maps BOX to BX', () => {
      expect(deriveQtyUnitCd('BOX')).toBe('BX');
    });

    it('maps PAIR to PR', () => {
      expect(deriveQtyUnitCd('PAIR')).toBe('PR');
    });

    it('maps DOZEN to DZ', () => {
      expect(deriveQtyUnitCd('DOZEN')).toBe('DZ');
    });

    it('maps GRAM to GRM', () => {
      expect(deriveQtyUnitCd('GRAM')).toBe('GRM');
    });

    it('maps ML to U (fallback)', () => {
      expect(deriveQtyUnitCd('ML')).toBe('U');
    });

    it('maps OTHER to U (fallback)', () => {
      expect(deriveQtyUnitCd('OTHER')).toBe('U');
    });

    it('falls back to U for unknown units', () => {
      expect(deriveQtyUnitCd('UNKNOWN')).toBe('U');
    });

    it('handles null/undefined', () => {
      expect(deriveQtyUnitCd(null)).toBe('U');
      expect(deriveQtyUnitCd(undefined)).toBe('U');
    });
  });

  describe('buildItemCd', () => {
    it('generates RW2CTKG0000012 for Rwanda finished product', () => {
      const result = buildItemCd('PRODUCT', 'CT', 'KG', 12, 'RW');
      expect(result).toBe('RW2CTKG0000012');
    });

    it('generates UG2NTBA0000013 for Uganda finished product', () => {
      const result = buildItemCd('PRODUCT', 'NT', 'BA', 13, 'UG');
      expect(result).toBe('UG2NTBA0000013');
    });

    it('generates KE1CTKG0000014 for Kenya raw material', () => {
      const result = buildItemCd('RAW_MATERIAL', 'CT', 'KG', 14, 'KE');
      expect(result).toBe('KE1CTKG0000014');
    });

    it('generates RW3CTKG0000015 for Rwanda service', () => {
      const result = buildItemCd('SERVICE', 'CT', 'KG', 15, 'RW');
      expect(result).toBe('RW3CTKG0000015');
    });

    it('uses DEFAULT_PKG_UNIT_CD when pkgUnitCd is null', () => {
      const result = buildItemCd('PRODUCT', null, 'KG', 1, 'RW');
      expect(result).toBe('RW2CTKG0000001');
    });

    it('uses DEFAULT_PKG_UNIT_CD when pkgUnitCd is undefined', () => {
      const result = buildItemCd('PRODUCT', undefined, 'KG', 1, 'RW');
      expect(result).toBe('RW2CTKG0000001');
    });

    it('pads sequence to 7 digits', () => {
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'RW')).toBe('RW2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 12, 'RW')).toBe('RW2CTKG0000012');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 123, 'RW')).toBe('RW2CTKG0000123');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1234567, 'RW')).toBe('RW2CTKG1234567');
    });

    it('works with different country codes', () => {
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'RW')).toBe('RW2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'UG')).toBe('UG2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'KE')).toBe('KE2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'TZ')).toBe('TZ2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'BI')).toBe('BI2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'CD')).toBe('CD2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'SS')).toBe('SS2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'ET')).toBe('ET2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'EG')).toBe('EG2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'ZA')).toBe('ZA2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'US')).toBe('US2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'CN')).toBe('CN2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'IN')).toBe('IN2CTKG0000001');
    });

    it('works with different packaging units', () => {
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'RW')).toBe('RW2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'BG', 'KG', 1, 'RW')).toBe('RW2BGKG0000001');
      expect(buildItemCd('PRODUCT', 'BX', 'KG', 1, 'RW')).toBe('RW2BXKG0000001');
      expect(buildItemCd('PRODUCT', 'CS', 'KG', 1, 'RW')).toBe('RW2CSKG0000001');
      expect(buildItemCd('PRODUCT', 'DR', 'KG', 1, 'RW')).toBe('RW2DRKG0000001');
    });

    it('works with different quantity units', () => {
      expect(buildItemCd('PRODUCT', 'CT', 'KG', 1, 'RW')).toBe('RW2CTKG0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'U', 1, 'RW')).toBe('RW2CTU0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'LTR', 1, 'RW')).toBe('RW2CTLTR0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'MTR', 1, 'RW')).toBe('RW2CTMTR0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'PR', 1, 'RW')).toBe('RW2CTPR0000001');
      expect(buildItemCd('PRODUCT', 'CT', 'DZ', 1, 'RW')).toBe('RW2CTDZ0000001');
    });
  });

  describe('RRA country codes', () => {
    it('includes Rwanda (RW)', () => {
      expect(isValidRraCountryCode('RW')).toBe(true);
      expect(getRraCountryName('RW')).toBe('Rwanda');
    });

    it('includes EAC partner states', () => {
      expect(isValidRraCountryCode('UG')).toBe(true);
      expect(isValidRraCountryCode('KE')).toBe(true);
      expect(isValidRraCountryCode('TZ')).toBe(true);
      expect(isValidRraCountryCode('BI')).toBe(true);
      expect(isValidRraCountryCode('SS')).toBe(true);
    });

    it('includes other African countries', () => {
      expect(isValidRraCountryCode('CD')).toBe(true);
      expect(isValidRraCountryCode('ET')).toBe(true);
      expect(isValidRraCountryCode('EG')).toBe(true);
      expect(isValidRraCountryCode('ZA')).toBe(true);
      expect(isValidRraCountryCode('NG')).toBe(true);
      expect(isValidRraCountryCode('GH')).toBe(true);
    });

    it('includes international countries', () => {
      expect(isValidRraCountryCode('US')).toBe(true);
      expect(isValidRraCountryCode('CN')).toBe(true);
      expect(isValidRraCountryCode('IN')).toBe(true);
      expect(isValidRraCountryCode('GB')).toBe(true);
      expect(isValidRraCountryCode('FR')).toBe(true);
      expect(isValidRraCountryCode('DE')).toBe(true);
      expect(isValidRraCountryCode('JP')).toBe(true);
      expect(isValidRraCountryCode('AE')).toBe(true);
    });

    it('rejects invalid country codes', () => {
      expect(isValidRraCountryCode('XX')).toBe(false);
      expect(isValidRraCountryCode('ZZ')).toBe(false);
      expect(isValidRraCountryCode('R')).toBe(false);
      expect(isValidRraCountryCode('RWA')).toBe(false);
      expect(isValidRraCountryCode('')).toBe(false);
    });

    it('has all expected country codes in VALID_RRA_COUNTRY_CODES', () => {
      expect(VALID_RRA_COUNTRY_CODES).toContain('RW');
      expect(VALID_RRA_COUNTRY_CODES).toContain('UG');
      expect(VALID_RRA_COUNTRY_CODES).toContain('KE');
      expect(VALID_RRA_COUNTRY_CODES).toContain('TZ');
      expect(VALID_RRA_COUNTRY_CODES).toContain('BI');
      expect(VALID_RRA_COUNTRY_CODES).toContain('CD');
      expect(VALID_RRA_COUNTRY_CODES).toContain('SS');
      expect(VALID_RRA_COUNTRY_CODES).toContain('ET');
      expect(VALID_RRA_COUNTRY_CODES).toContain('EG');
      expect(VALID_RRA_COUNTRY_CODES).toContain('ZA');
      expect(VALID_RRA_COUNTRY_CODES).toContain('US');
      expect(VALID_RRA_COUNTRY_CODES).toContain('CN');
      expect(VALID_RRA_COUNTRY_CODES).toContain('IN');
      expect(VALID_RRA_COUNTRY_CODES.length).toBeGreaterThan(50);
    });
  });
});