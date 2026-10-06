import { PatientMedicalRecordsService } from './patient-medical-records.service';

describe('PatientMedicalRecordsService', () => {
  let prisma: any;
  let patientsService: any;
  let service: PatientMedicalRecordsService;

  const ownedPatient = { id: 'patient-1', userId: 'connect-1' };

  beforeEach(() => {
    prisma = {
      encounter: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      vitalSigns: { findMany: jest.fn().mockResolvedValue([]) },
      clinicalNote: { findMany: jest.fn().mockResolvedValue([]) },
      diagnosis: { findMany: jest.fn().mockResolvedValue([]) },
      prescription: { findMany: jest.fn().mockResolvedValue([]) },
      labOrder: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
    };
    patientsService = { getOwnPatientRecordOrThrow: jest.fn().mockResolvedValue(ownedPatient) };
    service = new PatientMedicalRecordsService(prisma, patientsService);
  });

  describe('ownership', () => {
    it('every listing method checks ownership before querying', async () => {
      await service.listEncounters('patient-1', 'connect-1');
      await service.listPrescriptions('patient-1', 'connect-1');
      await service.listLabOrders('patient-1', 'connect-1');
      await service.listInvoices('patient-1', 'connect-1');

      expect(patientsService.getOwnPatientRecordOrThrow).toHaveBeenCalledTimes(4);
      expect(patientsService.getOwnPatientRecordOrThrow).toHaveBeenCalledWith(
        'patient-1',
        'connect-1',
      );
    });

    it('propagates PATIENT_NOT_FOUND for a patientId the caller does not own, without querying clinical data', async () => {
      patientsService.getOwnPatientRecordOrThrow.mockRejectedValue(
        Object.assign(new Error('not found'), { code: 'PATIENT_NOT_FOUND' }),
      );

      await expect(
        service.listEncounters('someone-elses-patient', 'connect-1'),
      ).rejects.toMatchObject({
        code: 'PATIENT_NOT_FOUND',
      });
      expect(prisma.encounter.findMany).not.toHaveBeenCalled();
    });

    it('getEncounterDetail returns null (controller 404s) for an encounter not belonging to this patient', async () => {
      prisma.encounter.findFirst.mockResolvedValue(null);

      const result = await service.getEncounterDetail('patient-1', 'other-encounter', 'connect-1');

      expect(result).toBeNull();
      expect(prisma.encounter.findFirst).toHaveBeenCalledWith({
        where: { id: 'other-encounter', patientId: 'patient-1' },
      });
    });
  });

  describe('patient-safety visibility filtering', () => {
    it('listPrescriptions queries only FINALIZED/AMENDED statuses, excluding DRAFT and CANCELLED', async () => {
      await service.listPrescriptions('patient-1', 'connect-1');

      expect(prisma.prescription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'patient-1', status: { in: ['FINALIZED', 'AMENDED'] } },
        }),
      );
    });

    it('getEncounterDetail filters out a DRAFT diagnosis and a DRAFT prescription', async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: 'enc-1',
        hospitalId: 'hospital-a',
        doctorProfileId: 'doc-1',
        departmentId: 'dept-1',
        status: 'COMPLETED',
        startedAt: new Date(),
        endedAt: new Date(),
      });
      prisma.diagnosis.findMany.mockResolvedValue([
        { id: 'd-draft', status: 'DRAFT', description: 'maybe flu' },
        { id: 'd-final', status: 'FINALIZED', description: 'confirmed flu' },
      ]);
      prisma.prescription.findMany.mockResolvedValue([
        { id: 'p-draft', status: 'DRAFT', items: [] },
        { id: 'p-final', status: 'FINALIZED', items: [] },
      ]);

      const result = await service.getEncounterDetail('patient-1', 'enc-1', 'connect-1');

      expect(result!.diagnoses.map((d) => d.id)).toEqual(['d-final']);
      expect(result!.prescriptions.map((p) => p.id)).toEqual(['p-final']);
    });

    it('getEncounterDetail withholds an ENTERED (unverified) lab result but still shows the order item', async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: 'enc-1',
        hospitalId: 'hospital-a',
        doctorProfileId: 'doc-1',
        departmentId: 'dept-1',
        status: 'COMPLETED',
        startedAt: new Date(),
        endedAt: new Date(),
      });
      prisma.labOrder.findMany.mockResolvedValue([
        {
          id: 'lo-1',
          encounterId: 'enc-1',
          status: 'COMPLETED',
          orderedAt: new Date(),
          items: [
            {
              id: 'loi-1',
              labTestId: 'test-1',
              labTest: { name: 'CBC' },
              status: 'RESULT_READY',
              collectedAt: new Date(),
              result: {
                value: '5.2',
                unit: 'x10^9/L',
                referenceRange: '4-11',
                flag: null,
                status: 'ENTERED',
                verifiedAt: null,
              },
            },
          ],
        },
      ]);

      const result = await service.getEncounterDetail('patient-1', 'enc-1', 'connect-1');

      expect(result!.labOrders[0].items[0].result).toBeNull();
    });

    it('getEncounterDetail shows a VERIFIED lab result', async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: 'enc-1',
        hospitalId: 'hospital-a',
        doctorProfileId: 'doc-1',
        departmentId: 'dept-1',
        status: 'COMPLETED',
        startedAt: new Date(),
        endedAt: new Date(),
      });
      prisma.labOrder.findMany.mockResolvedValue([
        {
          id: 'lo-1',
          encounterId: 'enc-1',
          status: 'COMPLETED',
          orderedAt: new Date(),
          items: [
            {
              id: 'loi-1',
              labTestId: 'test-1',
              labTest: { name: 'CBC' },
              status: 'RESULT_READY',
              collectedAt: new Date(),
              result: {
                value: '5.2',
                unit: 'x10^9/L',
                referenceRange: '4-11',
                flag: null,
                status: 'VERIFIED',
                verifiedAt: new Date(),
              },
            },
          ],
        },
      ]);

      const result = await service.getEncounterDetail('patient-1', 'enc-1', 'connect-1');

      expect(result!.labOrders[0].items[0].result).toMatchObject({
        value: '5.2',
        status: 'VERIFIED',
      });
    });

    it('listInvoices excludes DRAFT invoices', async () => {
      await service.listInvoices('patient-1', 'connect-1');

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'patient-1', status: { notIn: ['DRAFT'] } },
        }),
      );
    });
  });
});
