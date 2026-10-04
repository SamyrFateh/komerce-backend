-- @migration 277_market_team_invitation_channels.sql
-- @domain    market-delegation
-- @purpose   Market Control Plane M4. Extend the existing invitation primitive
--            for the first operating lead: EMAIL or WHATSAPP, central inviter,
--            and explicit operating-lead intent. No message is sent here.

ALTER TABLE market_team_invitations
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN IF NOT EXISTS invited_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS grants_operating_lead BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE market_team_invitations invitation
   SET invited_by_user_id = membership.user_id
  FROM assignment_memberships membership
 WHERE invitation.invited_by_user_id IS NULL
   AND invitation.invited_by_membership_id = membership.id;

ALTER TABLE market_team_invitations
  ALTER COLUMN email_normalized DROP NOT NULL,
  ALTER COLUMN invited_by_membership_id DROP NOT NULL,
  ALTER COLUMN invited_by_user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'market_team_invitation_channel_check'
  ) THEN
    ALTER TABLE market_team_invitations
      ADD CONSTRAINT market_team_invitation_channel_check
      CHECK (channel IN ('EMAIL','WHATSAPP'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'market_team_invitation_phone_e164_check'
  ) THEN
    ALTER TABLE market_team_invitations
      ADD CONSTRAINT market_team_invitation_phone_e164_check
      CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\\+[1-9][0-9]{7,14}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'market_team_invitation_recipient_check'
  ) THEN
    ALTER TABLE market_team_invitations
      ADD CONSTRAINT market_team_invitation_recipient_check
      CHECK (
        (channel = 'EMAIL' AND email_normalized IS NOT NULL)
        OR
        (channel = 'WHATSAPP' AND phone_e164 IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'market_team_invitation_lead_requires_central_check'
  ) THEN
    ALTER TABLE market_team_invitations
      ADD CONSTRAINT market_team_invitation_lead_requires_central_check
      CHECK (grants_operating_lead = FALSE OR invited_by_membership_id IS NULL);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_market_team_invitation_phone
  ON market_team_invitations (assignment_id, phone_e164)
  WHERE status = 'PENDING' AND phone_e164 IS NOT NULL;

COMMENT ON COLUMN market_team_invitations.phone_e164 IS
  'E.164 recipient used when channel=WHATSAPP. No local-number guessing.';
COMMENT ON COLUMN market_team_invitations.channel IS
  'Invitation delivery intent: EMAIL or WHATSAPP. Delivery itself belongs to the notification layer.';
COMMENT ON COLUMN market_team_invitations.invited_by_user_id IS
  'Canonical inviter identity. invited_by_membership_id remains optional for delegated team invites.';
COMMENT ON COLUMN market_team_invitations.grants_operating_lead IS
  'When true, acceptance designates the resulting ACTIVE membership as operating lead; only central invitations may request it.';
