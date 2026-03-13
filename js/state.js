/**
 * Manifest state management for Takeoff Tooling
 */

const TakeoffState = (function () {
  const ITEM_TYPES = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems', 'permits', 'powerCoCharges', 'temporaryPower'];

  let manifest = [];
  let currentView = 'manifest'; // 'manifest' | 'device' | 'conduit' | 'wire'
  let currentItemId = null;
  let modalItemId = null;
  let conduitStep = 1; // 1: trenching, 2: fittings, 3: overage
  let conduitTempData = {};
  let deviceTempData = { boxes: [], covers: [] };
  let wireTempData = { overagePercent: null, macAdapters: [] };
  let showRemoveIcons = false;
  let showPrintOptions = false;
  let laborRate = 0;

  const UNDO_STACK_SIZE = 5;
  let undoStack = [];
  let redoStack = [];

  const LABOR_BOOK_TAB_ORDER = ['gear', 'lighting', 'devices', 'conduit', 'wire', 'specialSystems'];
  const LABOR_BOOK_TYPE_LABELS = { gear: 'Gear', lighting: 'Lighting', devices: 'Devices', conduit: 'Conduit', wire: 'Wire', specialSystems: 'Special Systems' };
  const LABOR_BOOK_GROUPS = {
    conduit: [
      {
        name: 'Fittings',
        sections: [
          'EMT fittings (SS) Elbows',
          'EMT fittings (SS) - Couplings',
          'EMT fittings (RT) - Connectors',
          'EMT fittings (RT) - Couplings',
          'RIGID fittings - Set 1',
          'LOCK NUTS',
          'BUSHINGS',
          'GROUNDINGS',
          'WEATHERHEAD',
          'LB Die Cast',
          'PVC Male Adapter',
          'PVC Female Adapter',
          'PVC BI',
          'PVC fitting',
        ],
      },
      {
        name: 'Connectors',
        sections: [
          'EMT Die Cast Set Screw connector insulated throat',
          'EMT Die Cast Raintight connector insulated throat',
          'EMT Steel Set Screw connector insulated throat',
          'EMT raintight steel connector insulated throat',
          'Flexible conduit (available in aluminum or steel)',
          'Weatherproof flexible conduit (Steel or aluminum) PVC exterior',
          'PVC 90 (Available in different sized sweeps) also there are pvc 45s And 30 degrees',
        ],
      },
      {
        name: 'Couplings',
        sections: [
          'EMT(SS)CP.INSL',
          'EMT(RT)CP.INSL',
          'EMT(SS)ST.CP.INSL',
          'EMT(RT)ST.CP.INSL',
          'Meyers Hubs',
          'Bolt on Hubs',
          'RIGID fittings - Set 2',
        ],
      },
      {
        name: 'Tubing',
        sections: [
          'EMT (Electro Mechanical Tubing)',
          'PVC (Tubing)',
          'FLEX Tubing (available in steel or aluminum)',
          'RGS (Ridgid Steel)',
          'IMC (Intermediate Medial Conduit)',
          'ST (Seal Tight)',
          "RGS (Smaller sizes under 10')",
          'PVC C',
        ],
      },
      {
        name: 'Special',
        sections: [
          'PVC GLUE',
          'Grounding rod',
          'PITCH PAN',
          'STRAP',
          'BOX Supports',
          'Cable Tray.3" DEEP',
          'Cable Tray.4" DEEP',
          'Cable Tray.6" DEEP',
        ],
      },
    ],
  };
  let activeLaborBookTab = 'gear';
  let laborBook = {
    gear: {
      Switchboards: [
        { name: '600a', labor: 16, price: '' },
        { name: '800a', labor: 24, price: '' },
        { name: '1200a', labor: 30, price: '' },
        { name: '1600a', labor: 36, price: '' },
        { name: '2000a', labor: 54, price: '' },
        { name: '4000a', labor: 90, price: '' },
      ],
      'Wire Terminations': [
        { name: '# 22-6', labor: 0.2, price: '' },
        { name: '# 4-1', labor: 0.3, price: '' },
        { name: '# 1/0-4/0', labor: 0.5, price: '' },
        { name: '# 250-500', labor: 1, price: '' },
        { name: '# 600-1000', labor: 1.5, price: '' },
      ],
      'Conduit Holes': [
        { name: '1/2" - 1"', labor: 0.3, price: '' },
        { name: '1-1/4" - 1-1/2"', labor: 0.5, price: '' },
        { name: '2-1/2" - 3"', labor: 0.8, price: '' },
        { name: '4" - 5" - 6"', labor: 1, price: '' },
      ],
      'Panels.1PH': [
        { name: '6', labor: 4.4, price: '' },
        { name: '8', labor: 5.6, price: '' },
        { name: '10', labor: 6.8, price: '' },
        { name: '12', labor: 8.0, price: '' },
        { name: '14', labor: 9.2, price: '' },
        { name: '16', labor: 10.4, price: '' },
        { name: '18', labor: 11.6, price: '' },
        { name: '20', labor: 12.8, price: '' },
        { name: '22', labor: 13.6, price: '' },
        { name: '24', labor: 14.4, price: '' },
        { name: '26', labor: 15.2, price: '' },
        { name: '28', labor: 16.0, price: '' },
        { name: '30', labor: 17.2, price: '' },
        { name: '32', labor: 18.4, price: '' },
        { name: '34', labor: 19.6, price: '' },
        { name: '36', labor: 20.8, price: '' },
        { name: '38', labor: 22.0, price: '' },
        { name: '40', labor: 24.0, price: '' },
        { name: '42', labor: 29.0, price: '' },
      ],
      'Panels.3PH': [
        { name: '6', labor: 4.6, price: '' },
        { name: '8', labor: 5.9, price: '' },
        { name: '10', labor: 7.0, price: '' },
        { name: '12', labor: 8.2, price: '' },
        { name: '14', labor: 9.4, price: '' },
        { name: '16', labor: 10.6, price: '' },
        { name: '18', labor: 11.8, price: '' },
        { name: '20', labor: 13.0, price: '' },
        { name: '22', labor: 14.1, price: '' },
        { name: '24', labor: 15.0, price: '' },
        { name: '26', labor: 15.8, price: '' },
        { name: '28', labor: 16.6, price: '' },
        { name: '30', labor: 17.8, price: '' },
        { name: '32', labor: 19.0, price: '' },
        { name: '34', labor: 20.2, price: '' },
        { name: '36', labor: 21.4, price: '' },
        { name: '38', labor: 22.6, price: '' },
        { name: '40', labor: 24.8, price: '' },
        { name: '42', labor: 31.8, price: '' },
      ],
      'Transformers.1PH': [
        { name: '5KVA', labor: 4.0, price: '' },
        { name: '7.5KVA', labor: 5.6, price: '' },
        { name: '10KVA', labor: 10.8, price: '' },
        { name: '15KVA', labor: 16.0, price: '' },
        { name: '25KVA', labor: 20.0, price: '' },
      ],
      'Transformers.3PH': [
        { name: '3KVA', labor: 3.9, price: '' },
        { name: '6KVA', labor: 5.2, price: '' },
        { name: '9KVA', labor: 7.9, price: '' },
        { name: '15KVA', labor: 13.5, price: '' },
        { name: '30KVA', labor: 16, price: '' },
        { name: '45KVA', labor: 20, price: '' },
        { name: '75KVA', labor: 32, price: '' },
        { name: '112.5KVA', labor: 50, price: '' },
        { name: '150KVA', labor: 52, price: '' },
        { name: '225KVA', labor: 68, price: '' },
        { name: '300KVA', labor: 88, price: '' },
        { name: '500KVA', labor: 145, price: '' },
      ],
    },
    lighting: {},
    devices: {},
    conduit: {
      'EMT (Electro Mechanical Tubing)': [
        { name: '1/2 EMT', labor: 0.033, price: '75.00' },
        { name: '3/4 EMT', labor: 0.036, price: '134.00' },
        { name: '1 EMT', labor: 0.04, price: '228.00' },
        { name: '1 1/4 EMT', labor: 0.053, price: '370.00' },
        { name: '1 1/2 EMT', labor: 0.066, price: '450.00' },
        { name: '2 EMT', labor: 0.075, price: '530.00' },
        { name: '2 1/2 EMT', labor: 0.096, price: '804.00' },
        { name: '3 EMT', labor: 0.126, price: '1019.00' },
        { name: '3 1/2 EMT', labor: 0.175, price: '1346.00' },
        { name: '4 EMT', labor: 0.196, price: '1377.00' },
      ],
      'PVC (Tubing)': [
        { name: '1/2 PVC', labor: 0.025, price: '96.00' },
        { name: '3/4 PVC', labor: 0.025, price: '116.00' },
        { name: '1 PVC', labor: 0.035, price: '170.00' },
        { name: '1 1/4 PVC', labor: 0.042, price: '240.00' },
        { name: '1 1/2 PVC', labor: 0.042, price: '280.00' },
        { name: '2 PVC', labor: 0.051, price: '350.00' },
        { name: '2 1/2 PVC', labor: 0.062, price: '550.00' },
        { name: '3 PVC', labor: 0.07, price: '660.00' },
        { name: '3 1/2 PVC', labor: 0.08, price: '840.00' },
        { name: '4 PVC', labor: 0.088, price: '930.00' },
      ],
      'FLEX Tubing (available in steel or aluminum)': [
        { name: '1/2 FLX', labor: 0.042, price: '72.00' },
        { name: '3/4 FLX', labor: 0.05, price: '130.00' },
        { name: '1 FLX', labor: 0.06, price: '156.00' },
        { name: '1 1/4 FLX', labor: 0.066, price: '220.00' },
        { name: '1 1/2 FLX', labor: 0.074, price: '300.00' },
        { name: '2 FLX', labor: 0.089, price: '400.00' },
        { name: '2 1/2 FLX', labor: 0.094, price: '600.00' },
        { name: '3 FLX', labor: 0.109, price: '700.00' },
        { name: '3 1/2 FLX', labor: 0.112, price: '800.00' },
        { name: '4 FLX', labor: 0.12, price: '1200.00' },
      ],
      'RGS (Ridgid Steel)': [
        { name: '1/2 RGS', labor: 0.037, price: '189.00' },
        { name: '3/4 RGS', labor: 0.04, price: '182.00' },
        { name: '1 RGS', labor: 0.047, price: '232.00' },
        { name: '1 1/4 RGS', labor: 0.062, price: '331.00' },
        { name: '1 1/2 RGS', labor: 0.072, price: '372.00' },
        { name: '2 RGS', labor: 0.086, price: '595.00' },
        { name: '2 1/2 RGS', labor: 0.11, price: '860.00' },
        { name: '3 RGS', labor: 0.145, price: '1270.00' },
        { name: '3 1/2 RGS', labor: 0.18, price: '1278.00' },
        { name: '4 RGS', labor: 0.225, price: '1740.00' },
      ],
      'IMC (Intermediate Medial Conduit)': [
        { name: '1/2 IMC', labor: 0.035, price: '92.00' },
        { name: '3/4 IMC', labor: 0.038, price: '114.00' },
        { name: '1 IMC', labor: 0.045, price: '171.00' },
        { name: '1 1/4 IMC', labor: 0.06, price: '218.00' },
        { name: '1 1/2 IMC', labor: 0.07, price: '274.00' },
        { name: '2 IMC', labor: 0.084, price: '356.00' },
        { name: '2 1/2 IMC', labor: 0.1, price: '702.00' },
        { name: '3 IMC', labor: 0.132, price: '905.00' },
        { name: '3 1/2 IMC', labor: 0.178, price: '1060.00' },
        { name: '4 IMC', labor: 0.2, price: '1165.00' },
      ],
      'ST (Seal Tight)': [
        { name: '1/2 ST', labor: 0.05, price: '80.00' },
        { name: '3/4 ST', labor: 0.06, price: '120.00' },
        { name: '1 ST', labor: 0.072, price: '120.00' },
        { name: '1 1/4 ST', labor: 0.079, price: '150.00' },
        { name: '1 1/2 ST', labor: 0.087, price: '200.00' },
        { name: '2 ST', labor: 0.106, price: '151.18' },
        { name: '2 1/2 ST', labor: 0.113, price: '276.38' },
        { name: '3 ST', labor: 0.132, price: '399.16' },
        { name: '3 1/2 ST', labor: 0.141, price: '550.20' },
        { name: '4 ST', labor: 0.152, price: '611.34' },
      ],
      'Cable Tray.3" DEEP': [
        { name: '6" WIDE', labor: 0.07, price: '' },
        { name: '9" WIDE', labor: 0.07, price: '' },
        { name: '12" WIDE', labor: 0.07, price: '' },
        { name: '18" WIDE', labor: 0.08, price: '' },
        { name: '24" WIDE', labor: 0.09, price: '' },
        { name: '30" WIDE', labor: 0.1, price: '' },
        { name: '36" WIDE', labor: 0.11, price: '' },
      ],
      'Cable Tray.4" DEEP': [
        { name: '6" WIDE', labor: 0.08, price: '' },
        { name: '9" WIDE', labor: 0.08, price: '' },
        { name: '12" WIDE', labor: 0.08, price: '' },
        { name: '18" WIDE', labor: 0.09, price: '' },
        { name: '24" WIDE', labor: 0.1, price: '' },
        { name: '30" WIDE', labor: 0.1, price: '' },
        { name: '36" WIDE', labor: 0.12, price: '' },
      ],
      'Cable Tray.6" DEEP': [
        { name: '6" WIDE', labor: 0.09, price: '' },
        { name: '9" WIDE', labor: 0.09, price: '' },
        { name: '12" WIDE', labor: 0.09, price: '' },
        { name: '18" WIDE', labor: 0.1, price: '' },
        { name: '24" WIDE', labor: 0.11, price: '' },
        { name: '30" WIDE', labor: 0.12, price: '' },
        { name: '36" WIDE', labor: 0.13, price: '' },
      ],
      'EMT fittings (SS) Elbows': [
        { name: '1/2" EMT(S)', labor: 0.18, price: '' },
        { name: '3/4" EMT(S)', labor: 0.29, price: '' },
        { name: '1" EMT(S)', labor: 0.52, price: '' },
        { name: '1 1/4" EMT(S)', labor: 1.03, price: '' },
        { name: '1 1/2" EMT(S)', labor: 1.53, price: '' },
        { name: '2" EMT(S)', labor: 2.2, price: '' },
        { name: '2 1/2" EMT(S)', labor: 6.33, price: '' },
        { name: '3" EMT(S)', labor: 7.63, price: '' },
        { name: '3 1/2" EMT(S)', labor: 10.98, price: '' },
        { name: '4" EMT(S)', labor: 12.24, price: '' },
      ],
      'EMT fittings (SS) - Couplings': [
        { name: '1/2" EMT(S)', labor: 0.23, price: '' },
        { name: '3/4" EMT(S)', labor: 0.36, price: '' },
        { name: '1" EMT(S)', labor: 0.6, price: '' },
        { name: '1 1/4" EMT(S)', labor: 1.2, price: '' },
        { name: '1 1/2" EMT(S)', labor: 1.81, price: '' },
        { name: '2" EMT(S)', labor: 2.49, price: '' },
        { name: '2 1/2" EMT(S)', labor: 5.05, price: '' },
        { name: '3" EMT(S)', labor: 5.66, price: '' },
        { name: '3 1/2" EMT(S)', labor: 6.81, price: '' },
        { name: '4" EMT(S)', labor: 8.1, price: '' },
      ],
      'EMT fittings (RT) - Connectors': [
        { name: '1/2" EMT(R)', labor: 0.33, price: '' },
        { name: '3/4" EMT(R)', labor: 0.47, price: '' },
        { name: '1" EMT(R)', labor: 0.75, price: '' },
        { name: '1 1/4" EMT(R)', labor: 1.52, price: '' },
        { name: '1 1/2" EMT(R)', labor: 2.25, price: '' },
        { name: '2" EMT(R)', labor: 3.29, price: '' },
        { name: '2 1/2" EMT(R)', labor: 9.74, price: '' },
        { name: '3" EMT(R)', labor: 13.71, price: '' },
        { name: '3 1/2" EMT(R)', labor: 21.53, price: '' },
        { name: '4" EMT(R)', labor: 22.03, price: '' },
      ],
      'EMT fittings (RT) - Couplings': [
        { name: '1/2" EMT(R)', labor: 0.38, price: '' },
        { name: '3/4" EMT(R)', labor: 0.54, price: '' },
        { name: '1" EMT(R)', labor: 0.79, price: '' },
        { name: '1 1/4" EMT(R)', labor: 1.6, price: '' },
        { name: '1 1/2" EMT(R)', labor: 2.41, price: '' },
        { name: '2" EMT(R)', labor: 3.36, price: '' },
        { name: '2 1/2" EMT(R)', labor: 12.09, price: '' },
        { name: '3" EMT(R)', labor: 15.14, price: '' },
        { name: '3 1/2" EMT(R)', labor: 23.45, price: '' },
        { name: '4" EMT(R)', labor: 25.84, price: '' },
      ],
      'EMT Die Cast Set Screw connector insulated throat': [
        { name: '1/2" EMT(SS)CN.INSL', labor: 0.18, price: '' },
        { name: '3/4" EMT(SS)CN.INSL', labor: 0.28, price: '' },
        { name: '1" EMT(SS)CN.INSL', labor: 0.44, price: '' },
        { name: '1 1/4" EMT(SS)CN.INSL', labor: 0.91, price: '' },
        { name: '1 1/2" EMT(SS)CN.INSL', labor: 1.2, price: '' },
        { name: '2" EMT(SS)CN.INSL', labor: 1.75, price: '' },
        { name: '2 1/2" EMT(SS)CN.INSL', labor: 0, price: '' },
        { name: '3" EMT(SS)CN.INSL', labor: 0, price: '' },
        { name: '3 1/2" EMT(SS)CN.INSL', labor: 0, price: '' },
        { name: '4" EMT(SS)CN.INSL', labor: 0, price: '' },
      ],
      'EMT Die Cast Raintight connector insulated throat': [
        { name: '1/2" EMT(RT)CN.INSL', labor: 0.23, price: '' },
        { name: '3/4" EMT(RT)CN.INSL', labor: 0.34, price: '' },
        { name: '1" EMT(RT)CN.INSL', labor: 0.53, price: '' },
        { name: '1 1/4" EMT(RT)CN.INSL', labor: 0, price: '' },
        { name: '1 1/2" EMT(RT)CN.INSL', labor: 0, price: '' },
        { name: '2" EMT(RT)CN.INSL', labor: 0, price: '' },
        { name: '2 1/2" EMT(RT)CN.INSL', labor: 0, price: '' },
        { name: '3" EMT(RT)CN.INSL', labor: 0, price: '' },
        { name: '3 1/2" EMT(RT)CN.INSL', labor: 0, price: '' },
        { name: '4" EMT(RT)CN.INSL', labor: 0, price: '' },
      ],
      'EMT Steel Set Screw connector insulated throat': [
        { name: '1/2" EMT(SS)ST.CN.INSL', labor: 0.25, price: '' },
        { name: '3/4" EMT(SS)ST.CN.INSL', labor: 0.4, price: '' },
        { name: '1" EMT(SS)ST.CN.INSL', labor: 0.62, price: '' },
        { name: '1 1/4" EMT(SS)ST.CN.INSL', labor: 1.21, price: '' },
        { name: '1 1/2" EMT(SS)ST.CN.INSL', labor: 1.75, price: '' },
        { name: '2" EMT(SS)ST.CN.INSL', labor: 2.47, price: '' },
        { name: '2 1/2" EMT(SS)ST.CN.INSL', labor: 11.5, price: '' },
        { name: '3" EMT(SS)ST.CN.INSL', labor: 13.75, price: '' },
        { name: '3 1/2" EMT(SS)ST.CN.INSL', labor: 18.37, price: '' },
        { name: '4" EMT(SS)ST.CN.INSL', labor: 20.06, price: '' },
      ],
      'EMT raintight steel connector insulated throat': [
        { name: '1/2" EMT(RT)ST.CN.INSL', labor: 0.45, price: '' },
        { name: '3/4" EMT(RT)ST.CN.INSL', labor: 0.65, price: '' },
        { name: '1" EMT(RT)ST.CN.INSL', labor: 1, price: '' },
        { name: '1 1/4" EMT(RT)ST.CN.INSL', labor: 2.05, price: '' },
        { name: '1 1/2" EMT(RT)ST.CN.INSL', labor: 3.05, price: '' },
        { name: '2" EMT(RT)ST.CN.INSL', labor: 4.4, price: '' },
        { name: '2 1/2" EMT(RT)ST.CN.INSL', labor: 16.9, price: '' },
        { name: '3" EMT(RT)ST.CN.INSL', labor: 35.5, price: '' },
        { name: '3 1/2" EMT(RT)ST.CN.INSL', labor: 31.3, price: '' },
        { name: '4" EMT(RT)ST.CN.INSL', labor: 32.35, price: '' },
      ],
      'Flexible conduit (available in aluminum or steel)': [
        { name: '1/2" FLEX C', labor: 0.2, price: '' },
        { name: '3/4" FLEX C', labor: 0.61, price: '' },
        { name: '1" FLEX C', labor: 0.97, price: '' },
        { name: '1 1/4" FLEX C', labor: 2.13, price: '' },
        { name: '1 1/2" FLEX C', labor: 3.07, price: '' },
        { name: '2" FLEX C', labor: 4.23, price: '' },
        { name: '2 1/2" FLEX C', labor: 12, price: '' },
        { name: '3" FLEX C', labor: 16.6, price: '' },
        { name: '3 1/2" FLEX C', labor: 75.9, price: '' },
        { name: '4" FLEX C', labor: 99.75, price: '' },
      ],
      'Weatherproof flexible conduit (Steel or aluminum) PVC exterior': [
        { name: '1/2" SEALT', labor: 0.69, price: '' },
        { name: '3/4" SEALT', labor: 1.05, price: '' },
        { name: '1" SEALT', labor: 1.87, price: '' },
        { name: '1 1/4" SEALT', labor: 3.08, price: '' },
        { name: '1 1/2" SEALT', labor: 4.23, price: '' },
        { name: '2" SEALT', labor: 6.53, price: '' },
        { name: '2 1/2" SEALT', labor: 27.19, price: '' },
        { name: '3" SEALT', labor: 33.23, price: '' },
        { name: '3 1/2" SEALT', labor: 35.77, price: '' },
        { name: '4" SEALT', labor: 42, price: '' },
      ],
      'RIGID fittings - Set 1': [
        { name: '1/2" RIGID', labor: 1.21, price: '' },
        { name: '3/4" RIGID', labor: 1.5, price: '' },
        { name: '1" RIGID', labor: 2.16, price: '' },
        { name: '1 1/4" RIGID', labor: 3.13, price: '' },
        { name: '1 1/2" RIGID', labor: 3.74, price: '' },
        { name: '2" RIGID', labor: 5.77, price: '' },
        { name: '2 1/2" RIGID', labor: 9.52, price: '' },
        { name: '3" RIGID', labor: 14.24, price: '' },
        { name: '3 1/2" RIGID', labor: 23.48, price: '' },
        { name: '4" RIGID', labor: 27.24, price: '' },
      ],
      'EMT(SS)CP.INSL': [],
      'EMT(RT)CP.INSL': [],
      'EMT(SS)ST.CP.INSL': [],
      'EMT(RT)ST.CP.INSL': [],
      'Bolt on Hubs': [],
      'RIGID fittings - Set 2': [
        { name: '1/2" RIGID', labor: 0.36, price: '' },
        { name: '3/4" RIGID', labor: 0.44, price: '' },
        { name: '1" RIGID', labor: 0.66, price: '' },
        { name: '1 1/4" RIGID', labor: 0.82, price: '' },
        { name: '1 1/2" RIGID', labor: 1.04, price: '' },
        { name: '2" RIGID', labor: 1.37, price: '' },
        { name: '2 1/2" RIGID', labor: 2.49, price: '' },
        { name: '3" RIGID', labor: 4.15, price: '' },
        { name: '3 1/2" RIGID', labor: 5.55, price: '' },
        { name: '4" RIGID', labor: 5.59, price: '' },
      ],
      'LOCK NUTS': [
        { name: '1/2" LOCKN', labor: 0.04, price: '' },
        { name: '3/4" LOCKN', labor: 0.05, price: '' },
        { name: '1" LOCKN', labor: 0.09, price: '' },
        { name: '1 1/4" LOCKN', labor: 0.12, price: '' },
        { name: '1 1/2" LOCKN', labor: 0.19, price: '' },
        { name: '2" LOCKN', labor: 0.27, price: '' },
        { name: '2 1/2" LOCKN', labor: 0.61, price: '' },
        { name: '3" LOCKN', labor: 0.67, price: '' },
        { name: '3 1/2" LOCKN', labor: 1.03, price: '' },
        { name: '4" LOCKN', labor: 1.24, price: '' },
      ],
      BUSHINGS: [
        { name: '1/2" BUSHI', labor: 0.04, price: '' },
        { name: '3/4" BUSHI', labor: 0.05, price: '' },
        { name: '1" BUSHI', labor: 0.1, price: '' },
        { name: '1 1/4" BUSHI', labor: 0.11, price: '' },
        { name: '1 1/2" BUSHI', labor: 0.15, price: '' },
        { name: '2" BUSHI', labor: 0.29, price: '' },
        { name: '2 1/2" BUSHI', labor: 0.51, price: '' },
        { name: '3" BUSHI', labor: 0.56, price: '' },
        { name: '3 1/2" BUSHI', labor: 0.64, price: '' },
        { name: '4" BUSHI', labor: 0.72, price: '' },
      ],
      GROUNDINGS: [
        { name: '1/2" GROUI', labor: 0, price: '' },
        { name: '3/4" GROUI', labor: 0, price: '' },
        { name: '1" GROUI', labor: 0, price: '' },
        { name: '1 1/4" GROUI', labor: 3.5, price: '' },
        { name: '1 1/2" GROUI', labor: 3.7, price: '' },
        { name: '2" GROUI', labor: 4.9, price: '' },
        { name: '2 1/2" GROUI', labor: 7.5, price: '' },
        { name: '3" GROUI', labor: 9.8, price: '' },
        { name: '3 1/2" GROUI', labor: 0, price: '' },
        { name: '4" GROUI', labor: 13.8, price: '' },
      ],
      "RGS (Smaller sizes under 10')": [
        { name: '1/2" NIPPLE', labor: 0.65, price: '' },
        { name: '3/4" NIPPLE', labor: 0.8, price: '' },
        { name: '1" NIPPLE', labor: 1.25, price: '' },
        { name: '1 1/4" NIPPLE', labor: 1.55, price: '' },
        { name: '1 1/2" NIPPLE', labor: 2.3, price: '' },
        { name: '2" NIPPLE', labor: 3.15, price: '' },
        { name: '2 1/2" NIPPLE', labor: 6.5, price: '' },
        { name: '3" NIPPLE', labor: 7.3, price: '' },
        { name: '3 1/2" NIPPLE', labor: 9.8, price: '' },
        { name: '4" NIPPLE', labor: 11.55, price: '' },
      ],
      WEATHERHEAD: [
        { name: '1/2" WEATH', labor: 1.3, price: '' },
        { name: '3/4" WEATH', labor: 1.55, price: '' },
        { name: '1" WEATH', labor: 1.85, price: '' },
        { name: '1 1/4" WEATH', labor: 2.15, price: '' },
        { name: '1 1/2" WEATH', labor: 4.15, price: '' },
        { name: '2" WEATH', labor: 3.3, price: '' },
        { name: '2 1/2" WEATH', labor: 16.95, price: '' },
        { name: '3" WEATH', labor: 27.65, price: '' },
        { name: '3 1/2" WEATH', labor: 37.15, price: '' },
        { name: '4" WEATH', labor: 38.95, price: '' },
      ],
      'Meyers Hubs': [
        { name: '1/2" MEYER', labor: 2.85, price: '' },
        { name: '3/4" MEYER', labor: 3.2, price: '' },
        { name: '1" MEYER', labor: 4, price: '' },
        { name: '1 1/4" MEYER', labor: 4.55, price: '' },
        { name: '1 1/2" MEYER', labor: 5.35, price: '' },
        { name: '2" MEYER', labor: 7.65, price: '' },
        { name: '2 1/2" MEYER', labor: 15.05, price: '' },
        { name: '3" MEYER', labor: 21.2, price: '' },
        { name: '3 1/2" MEYER', labor: 27.75, price: '' },
        { name: '4" MEYER', labor: 34.8, price: '' },
      ],
      'LB Die Cast': [
        { name: '1/2" LB W/C', labor: 2.2, price: '' },
        { name: '3/4" LB W/C', labor: 2.8, price: '' },
        { name: '1" LB W/C', labor: 4, price: '' },
        { name: '1 1/4" LB W/C', labor: 5.65, price: '' },
        { name: '1 1/2" LB W/C', labor: 7.05, price: '' },
        { name: '2" LB W/C', labor: 12.25, price: '' },
        { name: '2 1/2" LB W/C', labor: 27.6, price: '' },
        { name: '3" LB W/C', labor: 35.7, price: '' },
        { name: '3 1/2" LB W/C', labor: 59.25, price: '' },
        { name: '4" LB W/C', labor: 66.4, price: '' },
      ],
      'PVC Male Adapter': [
        { name: '1/2" PVC M', labor: 0.24, price: '' },
        { name: '3/4" PVC M', labor: 0.41, price: '' },
        { name: '1" PVC M', labor: 0.54, price: '' },
        { name: '1 1/4" PVC M', labor: 0.68, price: '' },
        { name: '1 1/2" PVC M', labor: 0.87, price: '' },
        { name: '2" PVC M', labor: 1.27, price: '' },
        { name: '2 1/2" PVC M', labor: 2.3, price: '' },
        { name: '3" PVC M', labor: 3.06, price: '' },
        { name: '3 1/2" PVC M', labor: 4.22, price: '' },
        { name: '4" PVC M', labor: 6.39, price: '' },
      ],
      'PVC Female Adapter': [
        { name: '1/2" PVC FI', labor: 0.2, price: '' },
        { name: '3/4" PVC FI', labor: 0.33, price: '' },
        { name: '1" PVC FI', labor: 0.45, price: '' },
        { name: '1 1/4" PVC FI', labor: 0.56, price: '' },
        { name: '1 1/2" PVC FI', labor: 0.6, price: '' },
        { name: '2" PVC FI', labor: 0.87, price: '' },
        { name: '2 1/2" PVC FI', labor: 1.75, price: '' },
        { name: '3" PVC FI', labor: 2.4, price: '' },
        { name: '3 1/2" PVC FI', labor: 3.19, price: '' },
        { name: '4" PVC FI', labor: 3.57, price: '' },
      ],
      'PVC 90 (Available in different sized sweeps) also there are pvc 45s And 30 degrees': [
        { name: '1/2" PVC 90', labor: 0.48, price: '' },
        { name: '3/4" PVC 90', labor: 0.55, price: '' },
        { name: '1" PVC 90', labor: 0.83, price: '' },
        { name: '1 1/4" PVC 90', labor: 1.16, price: '' },
        { name: '1 1/2" PVC 90', labor: 1.6, price: '' },
        { name: '2" PVC 90', labor: 2.32, price: '' },
        { name: '2 1/2" PVC 90', labor: 4.21, price: '' },
        { name: '3" PVC 90', labor: 7.37, price: '' },
        { name: '3 1/2" PVC 90', labor: 10.2, price: '' },
        { name: '4" PVC 90', labor: 16.5, price: '' },
      ],
      'PVC BI': [
        { name: '1/2" PVC BI', labor: 0.25, price: '' },
        { name: '3/4" PVC BI', labor: 0.35, price: '' },
        { name: '1" PVC BI', labor: 1.25, price: '' },
        { name: '1 1/4" PVC BI', labor: 1.5, price: '' },
        { name: '1 1/2" PVC BI', labor: 1.5, price: '' },
        { name: '2" PVC BI', labor: 2.4, price: '' },
        { name: '2 1/2" PVC BI', labor: 2.5, price: '' },
        { name: '3" PVC BI', labor: 2.75, price: '' },
        { name: '3 1/2" PVC BI', labor: 3, price: '' },
        { name: '4" PVC BI', labor: 3.25, price: '' },
      ],
      'PVC fitting': [
        { name: '1/2" PVC fitting', labor: 0.5, price: '' },
        { name: '3/4" PVC fitting', labor: 0.55, price: '' },
        { name: '1" PVC fitting', labor: 0.6, price: '' },
        { name: '1 1/4" PVC fitting', labor: 0.8, price: '' },
        { name: '1 1/2" PVC fitting', labor: 0.88, price: '' },
        { name: '2" PVC fitting', labor: 0.65, price: '' },
        { name: '2 1/2" PVC fitting', labor: 0.55, price: '' },
        { name: '3" PVC fitting', labor: 0.75, price: '' },
        { name: '3 1/2" PVC fitting', labor: 1, price: '' },
        { name: '4" PVC fitting', labor: 1.25, price: '' },
      ],
      'PVC C': [
        { name: '1/2" PVC C', labor: 5.52, price: '' },
        { name: '3/4" PVC C', labor: 5.72, price: '' },
        { name: '1" PVC C', labor: 6.57, price: '' },
        { name: '1 1/4" PVC C', labor: 8.07, price: '' },
        { name: '1 1/2" PVC C', labor: 9.41, price: '' },
        { name: '2" PVC C', labor: 13.2, price: '' },
        { name: '2 1/2" PVC C', labor: 22.74, price: '' },
        { name: '3" PVC C', labor: 33.45, price: '' },
        { name: '3 1/2" PVC C', labor: 54.72, price: '' },
        { name: '4" PVC C', labor: 57.84, price: '' },
      ],
      'PVC GLUE': [
        { name: 'PVC GLUE', labor: 15, price: '' },
        { name: 'PVC GLUE', labor: 5, price: '' },
      ],
      'Grounding rod': [
        { name: '1/2" X 8\'', labor: 12, price: '' },
        { name: '1/2" X 10\'', labor: 15, price: '' },
        { name: '5/8" X 8\'', labor: 15, price: '' },
        { name: '5/8" X 10\'', labor: 18, price: '' },
        { name: '3/4" X 8\'', labor: 18, price: '' },
        { name: '3/4" X 10\'', labor: 20, price: '' },
        { name: 'Acorn nut 1/2"', labor: 0.1, price: '' },
        { name: 'Acorn nut 5/8"', labor: 0.1, price: '' },
        { name: 'Acorn nut 3/4"', labor: 0.1, price: '' },
        { name: 'Ground clamp 1"', labor: 0.1, price: '' },
        { name: 'Ground clamp 1 1/4"', labor: 0.1, price: '' },
        { name: 'Ground clamp 1 1/2"', labor: 0.1, price: '' },
        { name: 'Ground clamp 2"', labor: 0.1, price: '' },
        { name: 'Exothermic weld molds', labor: 0.1, price: '' },
        { name: 'Exothermic weld shots', labor: 0.1, price: '' },
      ],
      'PITCH PAN': [
        { name: 'PITCH PAN', labor: 12, price: '' },
        { name: 'Roofing pitch pan 4"x4"', labor: 12, price: '' },
        { name: 'Roofing pitch pan 6"x6"', labor: 12, price: '' },
      ],
      'BOX Supports': [
        { name: 'CADDY box support far side', labor: 0.1, price: '' },
        { name: 'CADDY complete support', labor: 0.1, price: '' },
      ],
      STRAP: [
        { name: '1/2" STRAP', labor: 0.04, price: '' },
        { name: '3/4" STRAP', labor: 0.06, price: '' },
        { name: '1" STRAP', labor: 0.1, price: '' },
        { name: '1 1/4" STRAP', labor: 1.2, price: '' },
        { name: '1 1/2" STRAP', labor: 1.35, price: '' },
        { name: '2" STRAP', labor: 1.75, price: '' },
        { name: '2 1/2" STRAP', labor: 2.25, price: '' },
        { name: '3" STRAP', labor: 2.75, price: '' },
        { name: '3 1/2" STRAP', labor: 3.5, price: '' },
        { name: '4" STRAP', labor: 5, price: '' },
        { name: 'Kindorf/Bline 1/2"', labor: 0.1, price: '' },
        { name: 'Kindorf/Bline 3/4" up to 4"', labor: 0.1, price: '' },
        { name: 'PVC strap 1 hole 1/2" to 2 1/2"', labor: 0.1, price: '' },
        { name: 'PVC strap 2 hole 1/2" to 2 1/2"', labor: 0.1, price: '' },
        { name: 'EMT strap 1 hole 1/2"', labor: 0.1, price: '' },
        { name: 'EMT strap 1 hole 3/4"', labor: 0.1, price: '' },
        { name: 'EMT strap 1 hole 1" to 4"', labor: 0.1, price: '' },
        { name: 'EMT strap 2 hole 1/2" to 4"', labor: 0.1, price: '' },
        { name: 'CADDY K8 flexible conduit strap to ceiling grid wire', labor: 0.1, price: '' },
        { name: 'CADDY bang-on type to 1/8" steel 1/2" thru 4" EMT conduit', labor: 0.1, price: '' },
      ],
    },
    wire: {
      'THHN CU': [
        { name: '14', labor: 0.003, price: '95.00' },
        { name: '12', labor: 0.004, price: '215.00' },
        { name: '10', labor: 0.006, price: '331.00' },
        { name: '8', labor: 0.007, price: '600.00' },
        { name: '6', labor: 0.011, price: '922.00' },
        { name: '4', labor: 0.014, price: '1411.00' },
        { name: '3', labor: 0.015, price: '1680.00' },
        { name: '2', labor: 0.02, price: '2126.00' },
        { name: '1', labor: 0.022, price: '2365.00' },
        { name: '1/0', labor: 0.025, price: '2900.00' },
        { name: '2/0', labor: 0.029, price: '3550.00' },
        { name: '3/0', labor: 0.032, price: '4600.00' },
        { name: '4/0', labor: 0.035, price: '5600.00' },
        { name: '250', labor: 0.037, price: '6400.00' },
        { name: '300', labor: 0.04, price: '7800.00' },
        { name: '350', labor: 0.044, price: '9000.00' },
        { name: '400', labor: 0.046, price: '10000.00' },
        { name: '500', labor: 0.051, price: '12800.00' },
        { name: '600', labor: 0.056, price: '16000.00' },
        { name: '750', labor: 0.06, price: '21000.00' },
        { name: '1000', labor: 0.07, price: '20000.00' },
      ],
      'THW AL': [
        { name: '4', labor: 0.014, price: '196.00' },
        { name: '3', labor: 0.015, price: '255.00' },
        { name: '2', labor: 0.02, price: '267.00' },
        { name: '1', labor: 0.022, price: '289.00' },
        { name: '1/0', labor: 0.025, price: '750.00' },
        { name: '2/0', labor: 0.029, price: '850.00' },
        { name: '3/0', labor: 0.032, price: '1050.00' },
        { name: '4/0', labor: 0.035, price: '1200.00' },
        { name: '250', labor: 0.037, price: '1450.00' },
        { name: '300', labor: 0.04, price: '2000.00' },
        { name: '350', labor: 0.044, price: '2000.00' },
        { name: '400', labor: 0.046, price: '2400.00' },
        { name: '500', labor: 0.051, price: '2600.00' },
        { name: '600', labor: 0.056, price: '3300.00' },
        { name: '750', labor: 0.06, price: '3800.00' },
        { name: 'WP 352', labor: 0.01, price: '90.00' },
        { name: 'PW', labor: 0.005, price: '0.03' },
      ],
    },
    specialSystems: {},
  };

  function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  function getManifest() {
    return manifest;
  }

  function getTopLevelItems() {
    return manifest.filter((item) => !item.parentId);
  }

  function getItemById(id) {
    for (const item of manifest) {
      if (item.id === id) return item;
      if (item.children) {
        const found = item.children.find((c) => c.id === id);
        if (found) return found;
      }
    }
    return null;
  }

  function getParentItem(id) {
    const item = getItemById(id);
    if (!item || !item.parentId) return null;
    return getItemById(item.parentId);
  }

  function getTopLevelParentId(id) {
    const item = getItemById(id);
    if (!item) return null;
    if (!item.parentId) return id;
    return getTopLevelParentId(item.parentId);
  }

  function deepCloneManifest() {
    return JSON.parse(JSON.stringify(manifest));
  }

  function pushUndo() {
    undoStack.push(deepCloneManifest());
    if (undoStack.length > UNDO_STACK_SIZE) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (undoStack.length === 0) return false;
    redoStack.push(deepCloneManifest());
    manifest = undoStack.pop();
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    undoStack.push(deepCloneManifest());
    manifest = redoStack.pop();
    return true;
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function canRedo() {
    return redoStack.length > 0;
  }

  function addItem(item) {
    pushUndo();
    const newItem = {
      id: item.id || generateId(),
      type: item.type || null,
      description: item.description || '',
      quantity: Number(item.quantity) || 0,
      labor: Number(item.labor) || 0,
      planPage: item.planPage ?? '',
      parentId: item.parentId ?? null,
      price: item.price ?? null,
      children: item.children || [],
      conduitMeta: item.conduitMeta || null,
    };
    if (item.parentId) {
      const parent = getItemById(item.parentId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(newItem);
      } else {
        manifest.push(newItem);
      }
    } else {
      manifest.push(newItem);
    }
    return newItem;
  }

  function updateItem(id, updates) {
    pushUndo();
    const item = getItemById(id);
    if (!item) return null;
    const parent = item.parentId ? getItemById(item.parentId) : null;
    const list = parent ? parent.children : manifest;
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    Object.assign(list[idx], updates);
    return list[idx];
  }

  function removeItem(id) {
    pushUndo();
    const item = getItemById(id);
    if (!item) return false;
    const parent = item.parentId ? getItemById(item.parentId) : null;
    const list = parent ? parent.children : manifest;
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }

  function setType(id, type) {
    return updateItem(id, { type });
  }

  function setCurrentView(view, itemId = null) {
    currentView = view;
    currentItemId = itemId;
  }

  function getCurrentView() {
    return currentView;
  }

  function getCurrentItemId() {
    return currentItemId;
  }

  function setModalItemId(id) {
    modalItemId = id;
  }

  function getModalItemId() {
    return modalItemId;
  }

  let laborBookPreselectedItemId = null;
  function setLaborBookPreselectedItemId(id) {
    laborBookPreselectedItemId = id;
  }
  function getLaborBookPreselectedItemId() {
    return laborBookPreselectedItemId;
  }
  function clearLaborBookPreselectedItemId() {
    laborBookPreselectedItemId = null;
  }

  let laborBookTargetDeviceRow = null;
  function setLaborBookTargetDeviceRow(val) {
    laborBookTargetDeviceRow = val;
  }
  function getLaborBookTargetDeviceRow() {
    return laborBookTargetDeviceRow;
  }
  function clearLaborBookTargetDeviceRow() {
    laborBookTargetDeviceRow = null;
  }

  let laborBookExpandGroup = null;
  function setLaborBookExpandGroup(name) {
    laborBookExpandGroup = name;
  }
  function getLaborBookExpandGroup() {
    return laborBookExpandGroup;
  }
  function clearLaborBookExpandGroup() {
    laborBookExpandGroup = null;
  }

  function setConduitStep(step) {
    conduitStep = step;
  }

  function getConduitStep() {
    return conduitStep;
  }

  function setConduitTempData(data) {
    conduitTempData = { ...conduitTempData, ...data };
  }

  function getConduitTempData() {
    return conduitTempData;
  }

  function clearConduitTempData() {
    conduitTempData = {};
  }

  function setDeviceTempData(data) {
    deviceTempData = { ...deviceTempData, ...data };
  }

  function getDeviceTempData() {
    return deviceTempData;
  }

  function clearDeviceTempData() {
    deviceTempData = { boxes: [], covers: [] };
  }

  function setWireTempData(data) {
    wireTempData = { ...wireTempData, ...data };
  }

  function getWireTempData() {
    return wireTempData;
  }

  function clearWireTempData() {
    wireTempData = { overagePercent: null, macAdapters: [] };
  }

  function getShowRemoveIcons() {
    return showRemoveIcons;
  }

  function setShowRemoveIcons(value) {
    showRemoveIcons = !!value;
  }

  function toggleShowRemoveIcons() {
    showRemoveIcons = !showRemoveIcons;
    return showRemoveIcons;
  }

  function getLaborRate() {
    return laborRate;
  }

  function setLaborRate(value) {
    laborRate = Number(value) || 0;
  }

  function getShowPrintOptions() {
    return showPrintOptions;
  }

  function toggleShowPrintOptions() {
    showPrintOptions = !showPrintOptions;
    return showPrintOptions;
  }

  function getLaborBook() {
    return laborBook;
  }

  function getActiveLaborBookTab() {
    return activeLaborBookTab;
  }

  function setActiveLaborBookTab(tab) {
    if (LABOR_BOOK_TAB_ORDER.includes(tab)) activeLaborBookTab = tab;
  }

  function getLaborBookTabOrder() {
    return LABOR_BOOK_TAB_ORDER;
  }

  function getLaborBookGroups(type) {
    return LABOR_BOOK_GROUPS[type] || null;
  }

  function getLaborBookType(type) {
    return laborBook[type] || {};
  }

  function setLaborBookSection(type, section, entries) {
    if (!laborBook[type]) laborBook[type] = {};
    laborBook[type][section] = entries || [];
  }

  function addLaborBookRow(type, section, row) {
    if (!laborBook[type]) laborBook[type] = {};
    if (!laborBook[type][section]) laborBook[type][section] = [];
    laborBook[type][section].push(row || { name: '', labor: 0, price: '' });
  }

  function removeLaborBookRow(type, section, index) {
    if (!laborBook[type]?.[section]) return;
    laborBook[type][section].splice(index, 1);
  }

  function addLaborBookSection(type, sectionName) {
    if (!laborBook[type]) laborBook[type] = {};
    laborBook[type][sectionName] = [];
  }

  function updateLaborBookRow(type, section, index, updates) {
    if (!laborBook[type]?.[section]?.[index]) return;
    Object.assign(laborBook[type][section][index], updates);
  }

  function getTotalLabor() {
    function sumLabor(items) {
      let total = 0;
      for (const item of items) {
        total += (item.labor || 0);
        if (item.children && item.children.length) {
          total += sumLabor(item.children);
        }
      }
      return total;
    }
    return sumLabor(manifest.filter((i) => !i.parentId));
  }

  function getTotalPrice() {
    function sumPrice(items) {
      let total = 0;
      for (const item of items) {
        const p = Number(item.price);
        const q = Number(item.quantity) || 0;
        if (!isNaN(p) && p > 0) total += p * q;
        if (item.children && item.children.length) {
          total += sumPrice(item.children);
        }
      }
      return total;
    }
    return sumPrice(manifest.filter((i) => !i.parentId));
  }

  function getFlattenedItems() {
    const result = [];
    function flatten(items, depth = 0) {
      for (const item of items) {
        result.push({ ...item, _depth: depth });
        if (item.children && item.children.length) {
          flatten(item.children, depth + 1);
        }
      }
    }
    flatten(manifest.filter((i) => !i.parentId));
    return result;
  }

  const MATERIAL_TYPES = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems'];
  const OTHER_TYPES = ['permits', 'powerCoCharges', 'temporaryPower'];
  const SALES_TAX_RATE = 0.085;

  function getSummaryBreakdown() {
    const materials = { lighting: 0, gear: 0, devices: 0, conduit: 0, wire: 0, specialSystems: 0, misc: 0 };
    const labor = { lighting: 0, gear: 0, devices: 0, conduit: 0, wire: 0, specialSystems: 0, misc: 0 };
    const otherCharges = { permits: 0, powerCoCharges: 0, temporaryPower: 0 };

    function processItems(items, parentType) {
      for (const item of items) {
        const type = item.type || parentType;
        const effectiveType = type || parentType;
        const qty = Number(item.quantity) || 0;
        const priceVal = Number(item.price);
        const effectiveQty = qty > 0 ? qty : (!isNaN(priceVal) && priceVal > 0 ? 1 : 0);
        const priceAmount = !isNaN(priceVal) && priceVal > 0 ? priceVal * effectiveQty : 0;
        const laborHrs = (item.labor || 0);

        if (OTHER_TYPES.includes(effectiveType)) {
          otherCharges[effectiveType] = (otherCharges[effectiveType] || 0) + priceAmount;
        } else if (MATERIAL_TYPES.includes(effectiveType)) {
          materials[effectiveType] = (materials[effectiveType] || 0) + priceAmount;
          labor[effectiveType] = (labor[effectiveType] || 0) + laborHrs;
        } else {
          materials.misc += priceAmount;
          labor.misc += laborHrs;
        }

        if (item.children && item.children.length) {
          processItems(item.children, effectiveType || parentType);
        }
      }
    }
    processItems(manifest.filter((i) => !i.parentId), null);

    const materialsSubtotal = [...MATERIAL_TYPES, 'misc'].reduce((s, t) => s + (materials[t] || 0), 0);
    const salesTax = materialsSubtotal * SALES_TAX_RATE;
    const materialsTotal = materialsSubtotal + salesTax;
    const laborTotal = [...MATERIAL_TYPES, 'misc'].reduce((s, t) => s + (labor[t] || 0), 0);
    const otherTotal = OTHER_TYPES.reduce((s, t) => s + (otherCharges[t] || 0), 0);

    return {
      materials,
      materialsSubtotal,
      salesTax,
      materialsTotal,
      labor,
      laborTotal,
      otherCharges,
      otherTotal,
    };
  }

  return {
    ITEM_TYPES,
    LABOR_BOOK_TYPE_LABELS,
    getManifest,
    getTopLevelItems,
    getItemById,
    getParentItem,
    addItem,
    updateItem,
    removeItem,
    setType,
    undo,
    redo,
    canUndo,
    canRedo,
    setCurrentView,
    getCurrentView,
    getCurrentItemId,
    setModalItemId,
    getModalItemId,
    setLaborBookPreselectedItemId,
    getLaborBookPreselectedItemId,
    clearLaborBookPreselectedItemId,
    setLaborBookTargetDeviceRow,
    getLaborBookTargetDeviceRow,
    clearLaborBookTargetDeviceRow,
    setLaborBookExpandGroup,
    getLaborBookExpandGroup,
    clearLaborBookExpandGroup,
    getTopLevelParentId,
    setConduitStep,
    getConduitStep,
    setConduitTempData,
    getConduitTempData,
    clearConduitTempData,
    setDeviceTempData,
    getDeviceTempData,
    clearDeviceTempData,
    setWireTempData,
    getWireTempData,
    clearWireTempData,
    getTotalLabor,
    getTotalPrice,
    getFlattenedItems,
    getSummaryBreakdown,
    generateId,
    getLaborRate,
    setLaborRate,
    getShowRemoveIcons,
    setShowRemoveIcons,
    toggleShowRemoveIcons,
    getShowPrintOptions,
    toggleShowPrintOptions,
    getLaborBook,
    getLaborBookTabOrder,
    getLaborBookGroups,
    getLaborBookType,
    setLaborBookSection,
    addLaborBookRow,
    removeLaborBookRow,
    addLaborBookSection,
    updateLaborBookRow,
    getActiveLaborBookTab,
    setActiveLaborBookTab,
  };
})();
