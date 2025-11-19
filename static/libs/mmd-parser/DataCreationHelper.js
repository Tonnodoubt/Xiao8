export class DataCreationHelper {
    constructor() { }
    static leftToRightVector3(v) {
        v[2] = -v[2];
    }
    static leftToRightQuaternion(q) {
        q[0] = -q[0];
        q[1] = -q[1];
    }
    static leftToRightEuler(r) {
        r[0] = -r[0];
        r[1] = -r[1];
    }
    static leftToRightIndexOrder(p) {
        const tmp = p[2];
        p[2] = p[0];
        p[0] = tmp;
    }
    static leftToRightVector3Range(v1, v2) {
        const tmp = -v2[2];
        v2[2] = -v1[2];
        v1[2] = tmp;
    }
    static leftToRightEulerRange(r1, r2) {
        const tmp1 = -r2[0];
        const tmp2 = -r2[1];
        r2[0] = -r1[0];
        r2[1] = -r1[1];
        r1[0] = tmp1;
        r1[1] = tmp2;
    }
}
