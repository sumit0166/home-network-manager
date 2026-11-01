import asyncio
from typing import Dict, Any, Optional, List, Tuple
from pysnmp.hlapi.v1arch.asyncio import (
    SnmpDispatcher,
    CommunityData,
    UdpTransportTarget,
    ObjectType,
    ObjectIdentity,
    get_cmd,
    walk_cmd
)

# Standard MIB-II OIDs
OID_SYS_DESCR = "1.3.6.1.2.1.1.1.0"
OID_SYS_OBJECT_ID = "1.3.6.1.2.1.1.2.0"
OID_SYS_UPTIME = "1.3.6.1.2.1.1.3.0"
OID_SYS_NAME = "1.3.6.1.2.1.1.5.0"

# WAN Interface (ppp0, Index 4)
OID_PPP0_IN_OCTETS = "1.3.6.1.2.1.2.2.1.10.4"
OID_PPP0_OUT_OCTETS = "1.3.6.1.2.1.2.2.1.16.4"
OID_PPP0_OPER_STATUS = "1.3.6.1.2.1.2.2.1.8.4"

# IF-MIB Table Roots
IF_NAME_ROOT = "1.3.6.1.2.1.2.2.1.2"
IF_MAC_ROOT = "1.3.6.1.2.1.2.2.1.6"
IF_ADMIN_ROOT = "1.3.6.1.2.1.2.2.1.7"
IF_OPER_ROOT = "1.3.6.1.2.1.2.2.1.8"
IF_IN_DISCARDS_ROOT = "1.3.6.1.2.1.2.2.1.13"
IF_IN_ERRORS_ROOT = "1.3.6.1.2.1.2.2.1.14"
IF_OUT_DISCARDS_ROOT = "1.3.6.1.2.1.2.2.1.19"
IF_OUT_ERRORS_ROOT = "1.3.6.1.2.1.2.2.1.20"

OPER_STATUS_MAP = {
    1: "UP",
    2: "DOWN",
    3: "TESTING",
    4: "UNKNOWN",
    5: "DORMANT",
    6: "NOT PRESENT",
    7: "LOWER LAYER DOWN"
}

def decode_mac(raw_bytes: Any) -> str:
    try:
        b = bytes(raw_bytes)
        if len(b) == 6:
            return ":".join(f"{x:02X}" for x in b)
        return b.hex(":")
    except Exception:
        return str(raw_bytes)

class SnmpClient:
    def __init__(self, host: str = "192.168.0.1", port: int = 161, community: str = "sumitsakpal0183"):
        self.host = host
        self.port = port
        self.community = community
        self.dispatcher = SnmpDispatcher()
        self.auth = CommunityData(self.community, mpModel=1)

    async def _get_target(self, timeout: float = 2.5, retries: int = 1):
        return await UdpTransportTarget.create(
            (self.host, self.port),
            timeout=timeout,
            retries=retries
        )

    async def get_single_oid(self, oid_str: str, timeout: float = 2.5) -> Optional[Any]:
        """Queries a single OID using tested individual get_cmd."""
        try:
            target = await self._get_target(timeout=timeout)
            error_indication, error_status, error_index, var_binds = await get_cmd(
                self.dispatcher,
                self.auth,
                target,
                ObjectType(ObjectIdentity(oid_str))
            )
            if error_indication or error_status:
                return None
            if var_binds and len(var_binds) > 0:
                return var_binds[0][1]
            return None
        except Exception:
            return None

    async def get_wan_counters(self) -> Optional[Dict[str, int]]:
        """
        Retrieves ppp0 in_octets, out_octets, and sys_uptime individually.
        Returns dict with integers or None on failure.
        """
        try:
            # Query in_octets (Download bytes)
            in_val = await self.get_single_oid(OID_PPP0_IN_OCTETS, timeout=2.0)
            if in_val is None:
                return None

            # Query out_octets (Upload bytes)
            out_val = await self.get_single_oid(OID_PPP0_OUT_OCTETS, timeout=2.0)
            if out_val is None:
                return None

            # Query sys_uptime (Router kernel uptime in hundredths of a second)
            uptime_val = await self.get_single_oid(OID_SYS_UPTIME, timeout=2.0)
            if uptime_val is None:
                return None

            return {
                "in_octets": int(in_val),
                "out_octets": int(out_val),
                "sys_uptime": int(uptime_val)
            }
        except Exception:
            return None

    async def get_system_info(self) -> Dict[str, Any]:
        """Queries router system metadata."""
        try:
            name = await self.get_single_oid(OID_SYS_NAME)
            descr = await self.get_single_oid(OID_SYS_DESCR)
            uptime = await self.get_single_oid(OID_SYS_UPTIME)
            obj_id = await self.get_single_oid(OID_SYS_OBJECT_ID)

            uptime_sec = int(uptime) // 100 if uptime else 0

            return {
                "sys_name": str(name) if name else "TL-WR850N",
                "sys_descr": str(descr) if descr else "TP-Link TL-WR850N",
                "sys_uptime_seconds": uptime_sec,
                "sys_object_id": str(obj_id) if obj_id else "1.3.6.1.4.1.11863",
                "status": "online" if name else "unreachable"
            }
        except Exception as e:
            return {
                "sys_name": "TL-WR850N",
                "sys_descr": "TP-Link Router",
                "sys_uptime_seconds": 0,
                "sys_object_id": "",
                "status": "error",
                "error": str(e)
            }

    async def get_interfaces_table(self) -> List[Dict[str, Any]]:
        """Walks IF-MIB to discover all router physical and logical interfaces."""
        try:
            target = await self._get_target(timeout=3.0, retries=1)

            async def walk_column(root_oid: str) -> Dict[int, Any]:
                res = {}
                try:
                    async for error_ind, error_stat, _, var_binds in walk_cmd(
                        self.dispatcher,
                        self.auth,
                        target,
                        ObjectType(ObjectIdentity(root_oid)),
                        lexicographicMode=False
                    ):
                        if error_ind or error_stat:
                            break
                        for o, val in var_binds:
                            idx = int(str(o).split(".")[-1])
                            res[idx] = val
                except Exception:
                    pass
                return res

            names = await walk_column(IF_NAME_ROOT)
            macs = await walk_column(IF_MAC_ROOT)
            admin_stats = await walk_column(IF_ADMIN_ROOT)
            oper_stats = await walk_column(IF_OPER_ROOT)
            in_errs = await walk_column(IF_IN_ERRORS_ROOT)
            out_errs = await walk_column(IF_OUT_ERRORS_ROOT)
            in_discs = await walk_column(IF_IN_DISCARDS_ROOT)
            out_discs = await walk_column(IF_OUT_DISCARDS_ROOT)

            interfaces = []
            for idx, raw_name in names.items():
                name_str = str(raw_name)
                oper_code = int(oper_stats.get(idx, 4))
                oper_text = OPER_STATUS_MAP.get(oper_code, "UNKNOWN")

                # Categorize interface role
                role = "Virtual / Other"
                is_hardware = False
                if name_str == "ppp0":
                    role = "WAN (Internet)"
                    is_hardware = True
                elif name_str == "br0":
                    role = "LAN Bridge"
                elif name_str == "eth0":
                    role = "Ethernet Hardware Switch"
                    is_hardware = True
                elif name_str.startswith("eth0."):
                    role = f"Ethernet VLAN ({name_str})"
                elif name_str == "ra0":
                    role = "Wi-Fi (Primary 2.4GHz Radio)"
                    is_hardware = True
                elif name_str.startswith("ra"):
                    role = f"Wi-Fi Virtual AP ({name_str})"
                elif name_str == "apcli0":
                    role = "Wi-Fi Client / Mesh"
                elif name_str == "lo":
                    role = "Loopback"

                mac_val = macs.get(idx, b"")
                mac_str = decode_mac(mac_val) if mac_val else ""

                interfaces.append({
                    "index": idx,
                    "name": name_str,
                    "role": role,
                    "is_hardware": is_hardware,
                    "status": oper_text,
                    "is_up": oper_code == 1,
                    "mac": mac_str,
                    "in_errors": int(in_errs.get(idx, 0)),
                    "out_errors": int(out_errs.get(idx, 0)),
                    "in_discards": int(in_discs.get(idx, 0)),
                    "out_discards": int(out_discs.get(idx, 0))
                })

            # Sort: Hardware & WAN first, then alphabetical
            interfaces.sort(key=lambda x: (not x["is_hardware"], x["name"]))
            return interfaces
        except Exception:
            return []

    def close(self):
        try:
            if hasattr(self, "dispatcher") and self.dispatcher:
                # Close transport gently
                pass
        except Exception:
            pass
