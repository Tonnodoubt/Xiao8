import type { Quaternion, Vector3 } from "./Math";
export declare class DataCreationHelper {
    private constructor();
    static leftToRightVector3(v: Vector3): void;
    static leftToRightQuaternion(q: Quaternion): void;
    static leftToRightEuler(r: Vector3): void;
    static leftToRightIndexOrder(p: Vector3): void;
    static leftToRightVector3Range(v1: Vector3, v2: Vector3): void;
    static leftToRightEulerRange(r1: Vector3, r2: Vector3): void;
}
