UPDATE "Automation"
SET
  "openingDmButtonLabel" = 'Send me the link',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "platform" = 'FACEBOOK'
  AND 'JOURNAL' = ANY ("keywords")
  AND "openingDmButtonLabel" = 'View on Amazon';
