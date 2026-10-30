import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const metrics = [
  { label: 'People', hint: 'Directory and account lifecycle' },
  { label: 'Sessions', hint: 'Active devices and revocation' },
  { label: 'Audit', hint: 'Sensitive authentication events' },
]

export function AdminOverview() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {metrics.map((metric) => (
        <Card key={metric.label}>
          <CardHeader>
            <CardDescription>{metric.label}</CardDescription>
            <CardTitle className="font-display text-3xl">—</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{metric.hint}. Live figures arrive with admin integration.</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
