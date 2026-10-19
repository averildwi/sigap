/**
 * Region normalisation for duplicate checks only (BR-12).
 * The original text stays stored as typed; this never formats anything.
 */

export type RegionField = 'province' | 'city' | 'district' | 'village';

interface RegionPrefixConfig {
  prefixes: string[];
  // City keeps its marker, so "Kota Bogor" and "Kabupaten Bogor" stay distinct.
  markers?: Record<string, string>;
}

const PREFIX_CONFIG: Record<RegionField, RegionPrefixConfig> = {
  province: { prefixes: ['provinsi', 'prov'] },
  city: {
    prefixes: ['kota', 'kabupaten', 'kab'],
    markers: { kota: 'kota:', kabupaten: 'kab:', kab: 'kab:' },
  },
  district: { prefixes: ['kecamatan', 'kec'] },
  village: { prefixes: ['kelurahan', 'kel', 'desa', 'ds'] },
};

/**
 * Normalises one region field per BR-12:
 * (1) lowercase; (2) every character that is not a letter, digit or space
 * becomes a space; (3) collapse spaces and trim; (4) when the first whole
 * word is that field's prefix AND more words follow, drop it (province,
 * district, village) or keep its marker (city); (5) remove the remaining
 * spaces.
 *
 * "Kel. Suka Maju" -> "sukamaju", "Kelapa Gading" -> "kelapagading",
 * "Kotabaru" -> "kotabaru", "Kota Bogor" -> "kota:bogor",
 * "Kab. Bogor" and "Kabupaten Bogor" -> "kab:bogor".
 */
export function normaliseRegionPart(field: RegionField, text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const [first, ...rest] = words;
  const config = PREFIX_CONFIG[field];

  // A prefix only counts as a whole leading word with a name after it:
  // "kotabaru" or a bare "kel" is kept as it is.
  if (config.prefixes.includes(first ?? '') && rest.length > 0) {
    const marker = config.markers?.[first] ?? '';
    return `${marker}${rest.join('')}`;
  }
  return words.join('');
}
