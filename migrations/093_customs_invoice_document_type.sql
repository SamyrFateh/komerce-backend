-- 093_customs_invoice_document_type.sql
-- Ajoute le type de document 'customs_invoice' à la table transaction_documents.
--
-- Doctrine : DOUANE_DECLARATION_PIVOT.md — Lot B
-- La facture classifiée par colis est le document que l'agent douanier lit.
-- Elle est générée automatiquement lors de la déclaration (declareCustomsPayment).
-- Sujet : parcel_id (l'unité de déclaration).

-- 1. Séquence pour les références factures douane
CREATE SEQUENCE IF NOT EXISTS public.customs_invoice_seq
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- 2. Ajouter customs_invoice à la contrainte de type
ALTER TABLE public.transaction_documents
  DROP CONSTRAINT IF EXISTS transaction_documents_type_check;

ALTER TABLE public.transaction_documents
  ADD CONSTRAINT transaction_documents_type_check
  CHECK (document_type = ANY (ARRAY[
    'refund_receipt',
    'contribution_receipt',
    'wallet_receipt',
    'pickup_proof',
    'purchase_order',
    'customs_invoice'
  ]));
