alter table private.event_moderation_actions
  drop constraint event_moderation_actions_previous_status_check,
  drop constraint event_moderation_actions_new_status_check,
  add constraint event_moderation_actions_previous_status_check check (
    previous_status in (
      'not_evaluated',
      'clear',
      'under_review',
      'blocked',
      'removed'
    )
  ),
  add constraint event_moderation_actions_new_status_check check (
    new_status in (
      'not_evaluated',
      'clear',
      'under_review',
      'blocked',
      'removed'
    )
  );
