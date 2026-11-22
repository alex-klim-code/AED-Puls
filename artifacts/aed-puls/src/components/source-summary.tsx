import type { Aed } from '@workspace/api-client-react';

export function SourceSummary({aed}:{aed:Pick<Aed,'publicationCount'|'independentSourceCount'|'sourceConflict'|'provenance'|'sourceName'>}){
  const providers=Array.from(new Set(
    aed.provenance?.length?aed.provenance.map(p=>[p.sourceName,p.publisher].filter(Boolean).join(' — ')):[aed.sourceName]
  )).filter(Boolean);
  return <div className="my-3 rounded-lg border bg-muted/40 p-3 text-sm">
    <p className="font-semibold">{aed.publicationCount??0} publikacji danych · {aed.independentSourceCount??0} niezależnych źródeł pierwotnych</p>
    <p className="mt-2 font-semibold">Dostawcy danych zapisani przy tym AED:</p>
    <ul className="mt-1 list-disc space-y-1 pl-5">{providers.map(provider=><li key={provider}>{provider}</li>)}</ul>
    <p className="mt-2 text-xs text-muted-foreground">Każda publikacja pozostaje osobnym źródłem, także gdy opisuje ten sam punkt. Powiązanie nie zmienia licencji. Niezależni wydawcy są liczeni oddzielnie; liczba źródeł nie potwierdza sprawności AED.</p>
    {aed.sourceConflict&&<p role="alert" className="mt-2 font-semibold text-primary">Konflikt danych źródłowych. Sprawdź poszczególne publikacje; dostępność i godziny wymagają wyjaśnienia.</p>}
  </div>;
}
