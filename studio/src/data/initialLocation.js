/* Small, validated URL location handoff between the two independent app engines. */
export function initialLocation(query, fallback) {
  const params=new URLSearchParams(query);
  if(!params.has('lat') || !params.has('lon'))return {lat:fallback.lat,lon:fallback.lon};
  const lat=Number(params.get('lat')),lon=Number(params.get('lon'));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>80||Math.abs(lon)>180)
    return {lat:fallback.lat,lon:fallback.lon};
  return {lat,lon};
}
