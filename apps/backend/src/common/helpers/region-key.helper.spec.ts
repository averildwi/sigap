import { normaliseRegionPart } from './region-normalise.helper';
import { buildRegionKey } from './region-key.helper';

describe('normaliseRegionPart (BR-12)', () => {
  it('is equal for spellings that carry the same village name', () => {
    expect(normaliseRegionPart('village', 'Kel. Suka Maju')).toBe('sukamaju');
    expect(normaliseRegionPart('village', 'sukamaju')).toBe('sukamaju');
    expect(normaliseRegionPart('village', 'Kelurahan Suka maju!')).toBe(
      'sukamaju',
    );
  });

  it('keeps a look-alike village that does not start with a prefix', () => {
    expect(normaliseRegionPart('village', 'Kelapa Gading')).toBe(
      'kelapagading',
    );
  });

  it('is equal for the long and short district forms', () => {
    expect(normaliseRegionPart('district', 'Kec. Cimahi Tengah')).toBe(
      'cimahitengah',
    );
    expect(normaliseRegionPart('district', 'Kecamatan Cimahi Tengah')).toBe(
      'cimahitengah',
    );
  });

  it('marks Kota and Kabupaten cities so the two never collide', () => {
    expect(normaliseRegionPart('city', 'Kota Bogor')).toBe('kota:bogor');
    expect(normaliseRegionPart('city', 'Kab. Bogor')).toBe('kab:bogor');
    expect(normaliseRegionPart('city', 'Kabupaten Bogor')).toBe('kab:bogor');
    expect(normaliseRegionPart('city', 'kota cimahi')).toBe('kota:cimahi');
  });

  it('drops the province prefix', () => {
    expect(normaliseRegionPart('province', 'Provinsi Jawa Barat')).toBe(
      'jawabarat',
    );
    expect(normaliseRegionPart('province', 'Prov. Jawa Barat')).toBe(
      'jawabarat',
    );
  });

  it('only strips a prefix that is a whole leading word', () => {
    expect(normaliseRegionPart('village', 'Kotabaru')).toBe('kotabaru');
    expect(normaliseRegionPart('village', 'kel')).toBe('kel');
  });
});

describe('buildRegionKey (BR-12)', () => {
  it('builds the documented key for the demo community', () => {
    expect(
      buildRegionKey({
        rt: 1,
        rw: 6,
        village: 'Kel. Suka Maju',
        district: 'Kec. Cimahi Tengah',
        city: 'Kota Cimahi',
        province: 'Jawa Barat',
      }),
    ).toBe('1:6:sukamaju:cimahitengah:kota:cimahi:jawabarat');
  });

  it('treats different spellings of one region as the same key', () => {
    expect(
      buildRegionKey({
        rt: 1,
        rw: 6,
        village: 'sukamaju',
        district: 'cimahi tengah',
        city: 'kota cimahi',
        province: 'jawabarat',
      }),
    ).toBe(
      buildRegionKey({
        rt: 1,
        rw: 6,
        village: 'Kel. Suka Maju',
        district: 'Kecamatan Cimahi Tengah',
        city: 'Kota Cimahi',
        province: 'Provinsi Jawa Barat',
      }),
    );
  });

  it('keeps a Kota city and a Kabupaten city of one name apart', () => {
    const kota = buildRegionKey({
      rt: 2,
      rw: 3,
      village: 'Bogor Utara',
      district: 'Bogor Utara',
      city: 'Kota Bogor',
      province: 'Jawa Barat',
    });
    const kabupaten = buildRegionKey({
      rt: 2,
      rw: 3,
      village: 'Bogor Utara',
      district: 'Bogor Utara',
      city: 'Kab. Bogor',
      province: 'Jawa Barat',
    });
    expect(kota).not.toBe(kabupaten);
  });
});
