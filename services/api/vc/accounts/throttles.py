from rest_framework.throttling import AnonRateThrottle


class OtpRequestIpThrottle(AnonRateThrottle):
    scope = "otp_request_ip"

    def get_cache_key(self, request, view):  # apply to authenticated users too
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class OtpVerifyIpThrottle(OtpRequestIpThrottle):
    scope = "otp_verify_ip"


class AdminLoginThrottle(OtpRequestIpThrottle):
    scope = "admin_login"
