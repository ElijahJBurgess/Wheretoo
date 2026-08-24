type EditorStepLabels = readonly ['Details', 'Schedule & location', 'Review']

type StepRailProps = {
  current: 1 | 2 | 3
  labels: EditorStepLabels
}

export function StepRail({ current, labels }: StepRailProps) {
  return (
    <nav aria-label="Event creation progress">
      <ol className="step-rail">
        {labels.map((label, index) => {
          const step = (index + 1) as 1 | 2 | 3

          return (
            <li
              className={`step-rail__item${step < current ? ' step-rail__item--complete' : ''}`}
              key={label}
            >
              <span aria-current={step === current ? 'step' : undefined}>{label}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
