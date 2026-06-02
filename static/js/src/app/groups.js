var groups = []

// ---- SOC-redesign master-detail helpers -----------------------------------
// KPI row above the groups/members split.
function renderGroupKpis(groups) {
    var totalTargets = 0, lastImport = 0
    groups.forEach(function (g) {
        totalTargets += g.num_targets || 0
        var t = new Date(g.modified_date).getTime()
        if (t > lastImport) lastImport = t
    })
    var kpis = [
        { label: "Total Targets", icon: "fa-users", value: totalTargets.toLocaleString() },
        { label: "Groups", icon: "fa-th-large", value: groups.length },
        { label: "Last Updated", icon: "fa-calendar", value: lastImport ? moment(lastImport).format("MMM D") : "—", small: true }
    ]
    document.getElementById("groupKpis").innerHTML = kpis.map(function (k) {
        return '<div class="kpi"><div class="label"><span class="ic"><i class="fa ' + k.icon + '"></i></span>' + k.label + '</div>' +
            '<div class="value"' + (k.small ? ' style="font-size:22px"' : '') + '>' + k.value + '</div></div>'
    }).join("")
}

// One <tr> for the groups list (DOM-sourced DataTable; data-order drives sort).
function groupRowHtml(group) {
    var epoch = new Date(group.modified_date).getTime() || 0
    var updated = moment(group.modified_date).format('MMM Do YYYY, h:mm a')
    return '<tr style="cursor:pointer" data-group-id="' + group.id + '" data-group-name="' + escapeHtml(group.name) + '">' +
        '<td class="strong">' + escapeHtml(group.name) + '<div class="mono" style="font-size:10.5px;color:var(--ink-faint);font-weight:400;">GRP-' + group.id + '</div></td>' +
        '<td class="num strong" data-order="' + (group.num_targets || 0) + '">' + (group.num_targets || 0) + '</td>' +
        '<td class="num" data-order="' + epoch + '">' + updated + '</td>' +
        '<td class="no-sort"><div style="display:flex;gap:6px;justify-content:flex-end;">' +
        '<button class="icon-btn" style="width:30px;height:30px;" data-toggle="modal" data-backdrop="static" data-target="#modal" onclick="edit(' + group.id + ')" title="Edit Group"><i class="fa fa-pencil"></i></button>' +
        '<button class="icon-btn" style="width:30px;height:30px;color:var(--c-submitted);" onclick="deleteGroup(' + group.id + ')" title="Delete Group"><i class="fa fa-trash-o"></i></button>' +
        '</div></td>' +
        '</tr>'
}

// Load + render the members of the selected group into the right panel.
function loadMembers(id, name) {
    $("#groupTable tbody tr").removeClass("row-selected")
    $('#groupTable tbody tr[data-group-id="' + id + '"]').addClass("row-selected")
    $("#memberGroupName").text(name)
    $("#memberCount").text("loading…")
    $("#memberEmpty").hide()
    $("#memberEditBtn").show().off("click").on("click", function () {
        edit(id)
        $("#modal").modal("show")
    })
    api.groupId.get(id)
        .success(function (group) {
            var targets = group.targets || []
            $("#memberCount").text(targets.length + (targets.length === 1 ? " member" : " members"))
            if (!targets.length) {
                $("#memberTbody").html("")
                $("#memberEmpty").text("No members in this group yet.").show()
                return
            }
            $("#memberTbody").html(targets.map(function (t) {
                var full = ((t.first_name || "") + " " + (t.last_name || "")).trim() || t.email
                var initials = (((t.first_name || " ")[0] || "") + ((t.last_name || " ")[0] || "")).trim().toUpperCase() ||
                    ((t.email || "?")[0] || "?").toUpperCase()
                return '<tr><td class="strong"><div class="soc-row" style="gap:10px;">' +
                    '<span class="avatar" style="width:28px;height:28px;font-size:11px;border-radius:7px;">' + escapeHtml(initials) + '</span>' +
                    '<div>' + escapeHtml(full) + '<div class="mono" style="font-size:10.5px;color:var(--ink-faint);font-weight:400;">' + escapeHtml(t.email) + '</div></div>' +
                    '</div></td>' +
                    '<td>' + (t.position ? escapeHtml(t.position) : '<span class="muted">—</span>') + '</td></tr>'
            }).join(""))
        })
        .error(function () {
            $("#memberCount").text("")
            $("#memberTbody").html("")
            $("#memberEmpty").text("Error loading members.").show()
        })
}

// Save attempts to POST or PUT to /groups/
function save(id) {
    var targets = []
    $.each($("#targetsTable").DataTable().rows().data(), function (i, target) {
        targets.push({
            first_name: unescapeHtml(target[0]),
            last_name: unescapeHtml(target[1]),
            email: unescapeHtml(target[2]),
            position: unescapeHtml(target[3])
        })
    })
    var group = {
        name: $("#name").val(),
        targets: targets
    }
    // Submit the group
    if (id != -1) {
        // If we're just editing an existing group,
        // we need to PUT /groups/:id
        group.id = id
        api.groupId.put(group)
            .success(function (data) {
                successFlash("Group updated successfully!")
                load()
                dismiss()
                $("#modal").modal('hide')
            })
            .error(function (data) {
                modalError(data.responseJSON.message)
            })
    } else {
        // Else, if this is a new group, POST it
        // to /groups
        api.groups.post(group)
            .success(function (data) {
                successFlash("Group added successfully!")
                load()
                dismiss()
                $("#modal").modal('hide')
            })
            .error(function (data) {
                modalError(data.responseJSON.message)
            })
    }
}

function dismiss() {
    $("#targetsTable").dataTable().DataTable().clear().draw()
    $("#name").val("")
    $("#modal\\.flashes").empty()
}

function edit(id) {
    targets = $("#targetsTable").dataTable({
        destroy: true, // Destroy any other instantiated table - http://datatables.net/manual/tech-notes/3#destroy
        columnDefs: [{
            orderable: false,
            targets: "no-sort"
        }]
    })
    $("#modalSubmit").unbind('click').click(function () {
        save(id)
    })
    if (id == -1) {
        $("#groupModalLabel").text("New Group");
        var group = {}
    } else {
        $("#groupModalLabel").text("Edit Group");
        api.groupId.get(id)
            .success(function (group) {
                $("#name").val(group.name)
                targetRows = []
                $.each(group.targets, function (i, record) {
                  targetRows.push([
                      escapeHtml(record.first_name),
                      escapeHtml(record.last_name),
                      escapeHtml(record.email),
                      escapeHtml(record.position),
                      '<span style="cursor:pointer;"><i class="fa fa-trash-o"></i></span>'
                  ])
                });
                targets.DataTable().rows.add(targetRows).draw()
            })
            .error(function () {
                errorFlash("Error fetching group")
            })
    }
    // Handle file uploads
    $("#csvupload").fileupload({
        url: "/api/import/group",
        dataType: "json",
        beforeSend: function (xhr) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + user.api_key);
        },
        add: function (e, data) {
            $("#modal\\.flashes").empty()
            var acceptFileTypes = /(csv|txt)$/i;
            var filename = data.originalFiles[0]['name']
            if (filename && !acceptFileTypes.test(filename.split(".").pop())) {
                modalError("Unsupported file extension (use .csv or .txt)")
                return false;
            }
            data.submit();
        },
        done: function (e, data) {
            $.each(data.result, function (i, record) {
                addTarget(
                    record.first_name,
                    record.last_name,
                    record.email,
                    record.position);
            });
            targets.DataTable().draw();
        }
    })
}

var downloadCSVTemplate = function () {
    var csvScope = [{
        'First Name': 'Example',
        'Last Name': 'User',
        'Email': 'foobar@example.com',
        'Position': 'Systems Administrator'
    }]
    var filename = 'group_template.csv'
    var csvString = Papa.unparse(csvScope, {})
    var csvData = new Blob([csvString], {
        type: 'text/csv;charset=utf-8;'
    });
    if (navigator.msSaveBlob) {
        navigator.msSaveBlob(csvData, filename);
    } else {
        var csvURL = window.URL.createObjectURL(csvData);
        var dlLink = document.createElement('a');
        dlLink.href = csvURL;
        dlLink.setAttribute('download', filename)
        document.body.appendChild(dlLink)
        dlLink.click();
        document.body.removeChild(dlLink)
    }
}


var deleteGroup = function (id) {
    var group = groups.find(function (x) {
        return x.id === id
    })
    if (!group) {
        return
    }
    Swal.fire({
        title: "Are you sure?",
        text: "This will delete the group. This can't be undone!",
        type: "warning",
        animation: false,
        showCancelButton: true,
        confirmButtonText: "Delete " + escapeHtml(group.name),
        confirmButtonColor: "#428bca",
        reverseButtons: true,
        allowOutsideClick: false,
        preConfirm: function () {
            return new Promise(function (resolve, reject) {
                api.groupId.delete(id)
                    .success(function (msg) {
                        resolve()
                    })
                    .error(function (data) {
                        reject(data.responseJSON.message)
                    })
            })
        }
    }).then(function (result) {
        if (result.value){
            Swal.fire(
                'Group Deleted!',
                'This group has been deleted!',
                'success'
            );
        }
        $('button:contains("OK")').on('click', function () {
            location.reload()
        })
    })
}

function addTarget(firstNameInput, lastNameInput, emailInput, positionInput) {
    // Create new data row.
    var email = escapeHtml(emailInput).toLowerCase();
    var newRow = [
        escapeHtml(firstNameInput),
        escapeHtml(lastNameInput),
        email,
        escapeHtml(positionInput),
        '<span style="cursor:pointer;"><i class="fa fa-trash-o"></i></span>'
    ];

    // Check table to see if email already exists.
    var targetsTable = targets.DataTable();
    var existingRowIndex = targetsTable
        .column(2, {
            order: "index"
        }) // Email column has index of 2
        .data()
        .indexOf(email);
    // Update or add new row as necessary.
    if (existingRowIndex >= 0) {
        targetsTable
            .row(existingRowIndex, {
                order: "index"
            })
            .data(newRow);
    } else {
        targetsTable.row.add(newRow);
    }
}

function load() {
    $("#groupTable").hide()
    $("#emptyMessage").hide()
    $("#loading").show()
    api.groups.summary()
        .success(function (response) {
            $("#loading").hide()
            if (response.total > 0) {
                groups = response.groups
                $("#emptyMessage").hide()
                renderGroupKpis(groups)
                // Source the DataTable from the DOM so per-cell data-order
                // attributes drive correct numeric / date sorting.
                $("#groupTable tbody").html(groups.map(groupRowHtml).join(""))
                $("#groupTable").show()
                $("#groupTable").DataTable({
                    destroy: true,
                    columnDefs: [{ orderable: false, targets: "no-sort" }],
                    order: [[2, "desc"]]
                })
                // Auto-select the most recently updated group for the detail pane.
                var first = groups.slice().sort(function (a, b) {
                    return new Date(b.modified_date) - new Date(a.modified_date)
                })[0]
                if (first) { loadMembers(first.id, first.name) }
            } else {
                $("#emptyMessage").show()
                $("#groupTable").hide()
                $("#memberGroupName").text("Members")
                $("#memberCount").text("")
                $("#memberTbody").html("")
                $("#memberEditBtn").hide()
                $("#memberEmpty").text("No groups yet — create one to add members.").show()
            }
        })
        .error(function () {
            errorFlash("Error fetching groups")
        })
}

$(document).ready(function () {
    load()
    // Setup the event listeners
    // Handle manual additions
    $("#targetForm").submit(function () {
        // Validate the form data
        var targetForm = document.getElementById("targetForm")
        if (!targetForm.checkValidity()) {
            targetForm.reportValidity()
            return
        }
        addTarget(
            $("#firstName").val(),
            $("#lastName").val(),
            $("#email").val(),
            $("#position").val());
        targets.DataTable().draw();

        // Reset user input.
        $("#targetForm>div>input").val('');
        $("#firstName").focus();
        return false;
    });
    // Handle Deletion
    $("#targetsTable").on("click", "span>i.fa-trash-o", function () {
        targets.DataTable()
            .row($(this).parents('tr'))
            .remove()
            .draw();
    });
    $("#modal").on("hide.bs.modal", function () {
        dismiss();
    });
    $("#csv-template").click(downloadCSVTemplate)
    // Master-detail: click a group row (but not its action buttons) to load
    // its members into the right-hand panel.
    $("#groupTable tbody").on("click", "tr", function (e) {
        if ($(e.target).closest("button,a").length) { return }
        var id = $(this).data("group-id")
        var name = $(this).data("group-name")
        if (id != null && id !== "") { loadMembers(id, name) }
    })
});
