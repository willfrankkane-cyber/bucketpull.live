/* Bucket Pull Live: backend config.
   Leave both values empty to run the self-contained demo (sample data, nothing shared).
   Fill them in (Supabase → Project Settings → API) to switch every visitor into the shared live room.
   The anon/publishable key is public by design; row-level security in supabase/schema.sql protects the data. */
window.BP_CONFIG={
  SUPABASE_URL:'https://zwdogpkjxhpsrocqdnel.supabase.co',
  SUPABASE_ANON_KEY:'sb_publishable_3QWxRZ_v4fKh1w6dcCxkOQ_se7UJV4I'
};
/* ?demo=1 forces the demo on a configured site (handy for screenshots); ?demo=0 clears it. */
(function(){try{const q=new URLSearchParams(location.search);if(q.has('demo')){if(q.get('demo')==='1')localStorage.setItem('bp.demo','1');else localStorage.removeItem('bp.demo')}
  const c=window.BP_CONFIG;window.BP_LIVE=!!(c.SUPABASE_URL&&c.SUPABASE_ANON_KEY)&&localStorage.getItem('bp.demo')!=='1'}catch(e){window.BP_LIVE=false}})();
