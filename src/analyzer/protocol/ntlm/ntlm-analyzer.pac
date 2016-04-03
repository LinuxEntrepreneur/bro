
%extern{
#include "ConvertUTF.h"
%}

refine connection NTLM_Conn += {

	# This is copied from the RDP analyzer :(
	function utf16_to_utf8_val(utf16: bytestring): StringVal
		%{
		std::string resultstring;

		size_t utf8size = (3 * utf16.length() + 1);

		if ( utf8size > resultstring.max_size() )
			{
			bro_analyzer()->Weird("excessive_utf16_length");
			// If the conversion didn't go well, return the original data.
			return bytestring_to_val(utf16);
			}

		resultstring.resize(utf8size, '\0');

		// We can't assume that the string data is properly aligned
		// here, so make a copy.
		UTF16 utf16_copy[utf16.length()]; // Twice as much memory than necessary.
		memcpy(utf16_copy, utf16.begin(), utf16.length());

		const char* utf16_copy_end = reinterpret_cast<const char*>(utf16_copy) + utf16.length();
		const UTF16* sourcestart = utf16_copy;
		const UTF16* sourceend = reinterpret_cast<const UTF16*>(utf16_copy_end);

		UTF8* targetstart = reinterpret_cast<UTF8*>(&resultstring[0]);
		UTF8* targetend = targetstart + utf8size;

		ConversionResult res = ConvertUTF16toUTF8(&sourcestart,
		                                          sourceend,
		                                          &targetstart,
		                                          targetend,
		                                          lenientConversion);
		if ( res != conversionOK )
			{
			bro_analyzer()->Weird("utf16_conversion_failed");
			// If the conversion didn't go well, return the original data.
			return bytestring_to_val(utf16);
			}

		*targetstart = 0;

		// We're relying on no nulls being in the string.
		//return new StringVal(resultstring.length(), (const char *) resultstring.data());
		return new StringVal(resultstring.c_str());
		%}

	# This is replicated from the SMB analyzer. :(
	function filetime2brotime(ts: uint64): Val
		%{
		double secs = (ts / 10000000.0);

		// Bro can't support times back to the 1600's 
		// so we subtract a lot of seconds.
		Val* bro_ts = new Val(secs - 11644473600.0, TYPE_TIME);
		
		return bro_ts;
		%}

	function build_version_record(val: NTLM_Version): BroVal
		%{
		RecordVal* result = new RecordVal(BifType::Record::NTLM::Version);
		result->Assign(0, new Val(${val.major_version}, TYPE_COUNT));
		result->Assign(1, new Val(${val.minor_version}, TYPE_COUNT));
		result->Assign(2, new Val(${val.build_number},  TYPE_COUNT));
		result->Assign(3, new Val(${val.ntlm_revision}, TYPE_COUNT));

		return result;
		%}

	function build_av_record(val: NTLM_AV_Pair_Sequence): BroVal
		%{
		RecordVal* result = new RecordVal(BifType::Record::NTLM::AVs);
		for ( uint i = 0; ${val.pairs[i].id} != 0; i++ )
			{
			switch ( ${val.pairs[i].id} ) 
				{
				case 1:
					result->Assign(0, utf16_to_utf8_val(${val.pairs[i].nb_computer_name.data}));
					break;
				case 2:
					result->Assign(1, utf16_to_utf8_val(${val.pairs[i].nb_domain_name.data}));
					break;
				case 3:
					result->Assign(2, utf16_to_utf8_val(${val.pairs[i].dns_computer_name.data}));
					break;
				case 4:
					result->Assign(3, utf16_to_utf8_val(${val.pairs[i].dns_domain_name.data}));
					break;
				case 5:
					result->Assign(4, utf16_to_utf8_val(${val.pairs[i].dns_tree_name.data}));
					break;
				case 6:
					result->Assign(5, new Val(${val.pairs[i].constrained_auth}, TYPE_BOOL));
					break;
				case 7:
					result->Assign(6, filetime2brotime(${val.pairs[i].timestamp}));
					break;
				case 8:
					result->Assign(7, new Val(${val.pairs[i].single_host.machine_id}, TYPE_COUNT));
					break;
				case 9:
					result->Assign(8, utf16_to_utf8_val(${val.pairs[i].target_name.data}));
					break;
				}
			}
		return result;
		%}

	function build_negotiate_flag_record(val: NTLM_Negotiate_Flags): BroVal
		%{
		RecordVal* flags = new RecordVal(BifType::Record::NTLM::NegotiateFlags);
		flags->Assign(0, new Val(${val.negotiate_56},                        TYPE_BOOL));
		flags->Assign(1, new Val(${val.negotiate_key_exch},                  TYPE_BOOL));
		flags->Assign(2, new Val(${val.negotiate_128},                       TYPE_BOOL));
		flags->Assign(3, new Val(${val.negotiate_version},                   TYPE_BOOL));
		flags->Assign(4, new Val(${val.negotiate_target_info},               TYPE_BOOL));
		flags->Assign(5, new Val(${val.request_non_nt_session_key},          TYPE_BOOL));
		flags->Assign(6, new Val(${val.negotiate_identify},                  TYPE_BOOL));
		flags->Assign(7, new Val(${val.negotiate_extended_sessionsecurity},  TYPE_BOOL));
		flags->Assign(8, new Val(${val.target_type_server},                  TYPE_BOOL));
		flags->Assign(9, new Val(${val.target_type_domain},                  TYPE_BOOL));
		flags->Assign(10, new Val(${val.negotiate_always_sign},              TYPE_BOOL));
		flags->Assign(11, new Val(${val.negotiate_oem_workstation_supplied}, TYPE_BOOL));
		flags->Assign(12, new Val(${val.negotiate_oem_domain_supplied},      TYPE_BOOL));
		flags->Assign(13, new Val(${val.negotiate_anonymous_connection},     TYPE_BOOL));
		flags->Assign(14, new Val(${val.negotiate_ntlm},                     TYPE_BOOL));
		flags->Assign(15, new Val(${val.negotiate_lm_key},                   TYPE_BOOL));
		flags->Assign(16, new Val(${val.negotiate_datagram},                 TYPE_BOOL));
		flags->Assign(17, new Val(${val.negotiate_seal},                     TYPE_BOOL));
		flags->Assign(18, new Val(${val.negotiate_sign},                     TYPE_BOOL));
		flags->Assign(19, new Val(${val.request_target},                     TYPE_BOOL));
		flags->Assign(20, new Val(${val.negotiate_oem},                      TYPE_BOOL));
		flags->Assign(21, new Val(${val.negotiate_unicode},                  TYPE_BOOL));

		return flags;
		%}

	function proc_ntlm_negotiate(val: NTLM_Negotiate): bool
		%{
		RecordVal* result = new RecordVal(BifType::Record::NTLM::Negotiate);
		result->Assign(0, build_negotiate_flag_record(${val.flags}));

		if ( ${val.flags.negotiate_oem_domain_supplied} )
		        result->Assign(1, utf16_to_utf8_val(${val.domain_name.string.data}));

		if ( ${val.flags.negotiate_oem_workstation_supplied} )
		        result->Assign(2, utf16_to_utf8_val(${val.workstation.string.data}));

		if ( ${val.flags.negotiate_version} )
		        result->Assign(3, build_version_record(${val.version}));

		BifEvent::generate_ntlm_negotiate(bro_analyzer(), 
		                                  bro_analyzer()->Conn(),
		                                  result);

		return true;
		%}

	function proc_ntlm_challenge(val: NTLM_Challenge): bool
		%{
		RecordVal* result = new RecordVal(BifType::Record::NTLM::Challenge);
		result->Assign(0, build_negotiate_flag_record(${val.flags}));

		if ( ${val.flags.request_target} )
			result->Assign(1, utf16_to_utf8_val(${val.target_name.string.data}));

		if ( ${val.flags.negotiate_version} )
			result->Assign(2, build_version_record(${val.version}));

		if ( ${val.flags.negotiate_target_info} )
			result->Assign(3, build_av_record(${val.target_info}));

		BifEvent::generate_ntlm_challenge(bro_analyzer(), 
		                                  bro_analyzer()->Conn(),
		                                  result);

		return true;
		%}

	function proc_ntlm_authenticate(val: NTLM_Authenticate): bool
		%{
		RecordVal* result = new RecordVal(BifType::Record::NTLM::Authenticate);
		result->Assign(0, build_negotiate_flag_record(${val.flags}));

		if ( ${val.domain_name_fields.length} > 0 )
			result->Assign(1, utf16_to_utf8_val(${val.domain_name.string.data}));

		if ( ${val.user_name_fields.length} > 0 )
			result->Assign(2, utf16_to_utf8_val(${val.user_name.string.data}));

		if ( ${val.workstation_fields.length} > 0 )
			result->Assign(3, utf16_to_utf8_val(${val.workstation.string.data}));

		if ( ${val.flags.negotiate_version} )
			result->Assign(4, build_version_record(${val.version}));

		BifEvent::generate_ntlm_authenticate(bro_analyzer(),
		                                     bro_analyzer()->Conn(),
		                                     result);
		return true;
		%}
}

refine typeattr NTLM_Negotiate += &let {
	proc = $context.connection.proc_ntlm_negotiate(this);
};

refine typeattr NTLM_Challenge += &let {
	proc : bool = $context.connection.proc_ntlm_challenge(this);
};

refine typeattr NTLM_Authenticate += &let {
	proc : bool = $context.connection.proc_ntlm_authenticate(this);
};

