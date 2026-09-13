ALTER TABLE quality_finding ADD COLUMN present boolean NOT NULL DEFAULT true;
UPDATE quality_finding SET present=false WHERE state='resolved' AND mode='structural';
