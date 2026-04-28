# Event Flow V2

## Positioning

This is not a fully collaborative cart.

It is an event list managed by one organizer:

- the organizer is the only person who edits the real list
- relatives can suggest ideas, intended amounts, and messages
- the organizer reviews those suggestions
- the organizer finalizes the list
- payment starts only after final validation
- the Komerce order is created only after the required payments are secured

This model fits the expected real-world behavior better:

- clear ownership
- less confusion
- fewer write conflicts
- simpler support
- easier adoption in a WhatsApp-first environment

## Roles

### Organizer

The organizer can:

- create the event list
- add, update, and remove real items
- share the public family link
- review incoming suggestions
- finalize the list
- trigger the payment phase

The organizer cannot:

- expect participants to edit the real cart directly

### Participant

Participants can:

- view the current list
- suggest a product or gift idea
- declare an intended amount
- leave a message
- pay later if selected in the final payment phase

Participants cannot:

- add or remove real items from the organizer list
- finalize the list
- trigger the payment phase

## Canonical phases

The frontend and API should speak in these canonical phases:

1. `draft`
2. `collecting`
3. `reviewing`
4. `finalized`
5. `payment_pending`
6. `partially_paid`
7. `paid`
8. `order_created`
9. `expired`
10. `cancelled`

## Meaning of each phase

### `draft`

The organizer created the event but has not built the list yet.

### `collecting`

The organizer has started the list and can share it with relatives.
Suggestions are open.

### `reviewing`

The organizer is reviewing suggestions and intended amounts.
The list is still organizer-controlled.

### `finalized`

The organizer has frozen the list content.
No more item edits should be accepted.

### `payment_pending`

Payment links were generated and sent.
Waiting for full payment completion.

### `partially_paid`

Some payments are already secured, but the total is not complete yet.

### `paid`

The collective payment target is fully secured.

### `order_created`

The Komerce order was successfully created from the finalized event list.

### `expired`

The previous payment session expired.
The organizer may need to resume and relaunch.

### `cancelled`

The event flow was intentionally stopped.

## Product rules

These rules are the heart of V2:

1. Only the organizer edits the real list.
2. Public participants only create suggestions or intended contributions.
3. Public write access must never mutate `items`.
4. Finalization freezes the list.
5. Payment starts only after organizer finalization.
6. Order creation happens only after the collective payment condition is met.
7. Critical transitions must be idempotent.
8. Important actions should be auditable.

## UX guidance

### Organizer screen should emphasize

- My list
- Family suggestions
- Current phase
- Next step

### Participant screen should emphasize

- Current list
- Suggest an idea
- Declare an intended amount
- Leave a message

### Tone

The experience should feel:

- simple
- reassuring
- family-friendly
- WhatsApp-compatible
- not overly financial or technical

## API direction

The API can keep legacy DB statuses internally for compatibility, but should expose a canonical `phase` to the frontend.

Examples:

- `conception` + no items -> `draft`
- `conception` + items but no suggestions -> `collecting`
- `conception` + suggestions -> `reviewing`
- `payment_pending` + some secured amount -> `partially_paid`
- `session_ended` -> `expired`

## Migration strategy

### Phase 1

- keep current DB statuses
- expose canonical `phase`
- align organizer/public UI wording

### Phase 2

- enforce the organizer-only cart doctrine everywhere
- improve review/finalization UX
- separate suggestions clearly from payment steps

### Phase 3

- decide whether DB statuses should evolve to match the canonical model directly
- keep backward compatibility where necessary

## Summary

V2 is:

- organizer-led
- suggestion-friendly
- payment-safe
- easier to understand
- better adapted to the real expected usage
