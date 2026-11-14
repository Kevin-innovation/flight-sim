// Chase-camera maths kept pure (no shared scratch vectors with callers) so it
// can be regression-tested.
import { Vector3, Quaternion, Matrix4 } from 'three';

const _fwd = new Vector3();
const _up = new Vector3();
const _m = new Matrix4();

/** Desired chase position `back` metres behind and `high` metres above the aircraft. */
export function chaseTarget(flight, back, high, out = new Vector3()) {
  flight.getForward(_fwd);
  flight.getUp(_up);
  return out.copy(flight.position).addScaledVector(_fwd, -back).addScaledVector(_up, high);
}

/** Point the camera looks at: `ahead` metres in front of the aircraft. */
export function chaseLookAt(flight, ahead, out = new Vector3()) {
  flight.getForward(_fwd);
  return out.copy(flight.position).addScaledVector(_fwd, ahead);
}

/** Orientation looking from `eye` to `target` with `up`. */
export function lookRotation(eye, target, up, out = new Quaternion()) {
  _m.lookAt(eye, target, up);
  return out.setFromRotationMatrix(_m);
}
